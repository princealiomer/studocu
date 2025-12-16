import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';
import puppeteer from 'puppeteer'; // Local fallback
import { jsPDF } from 'jspdf';
import { NextResponse } from 'next/server';

export const maxDuration = 60; // Allow 60 seconds on Pro/Hobby (if supported)
export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const { url } = await req.json();

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        let browser;
        try {
            console.log('Launching browser...');
            if (process.env.NODE_ENV === 'development') {
                browser = await puppeteer.launch({
                    headless: true,
                });
            } else {
                browser = await puppeteerCore.launch({
                    args: chromium.args,
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
                });
            }

            const page = await browser.newPage();
            // Set User-Agent to avoid detection
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

            console.log(`Navigating to ${url}...`);

            // Navigate to the page
            // domcontentloaded is faster than networkidle2 and usually sufficient for scrolling to start
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            console.log('Page loaded, scrolling...');

            // Scroll to load all pages
            await autoScroll(page);
            console.log('Scroll complete. Extracting content...');

            // Extract images from .pc containers (User specific request)
            // or fall back to canvas
            const imageUrls = await page.evaluate(async () => {
                const results = [];

                const toBase64 = async (url) => {
                    try {
                        const response = await fetch(url);
                        const blob = await response.blob();

                        // Use createImageBitmap to handle valid image blobs
                        const bitmap = await createImageBitmap(blob);

                        const canvas = document.createElement('canvas');
                        canvas.width = bitmap.width;
                        canvas.height = bitmap.height;

                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(bitmap, 0, 0);

                        // Force JPEG 0.5 to reduce size and ensure valid header
                        return canvas.toDataURL('image/jpeg', 0.5);
                    } catch (e) {
                        console.error('Failed to convert/compress', url, e);
                        return null;
                    }
                };

                // Strategy 1: Look for div.pc (Page Containers) [Updated for robustness]
                const pcs = Array.from(document.querySelectorAll('.pc'));
                if (pcs.length > 0) {
                    console.log(`Found ${pcs.length} .pc elements`);
                    for (const pc of pcs) {
                        // Check for IMG tag
                        const img = pc.querySelector('img');
                        if (img && img.src) {
                            const b64 = await toBase64(img.src);
                            if (b64) results.push(b64);
                            continue;
                        }

                        // Check for Background Image
                        const style = window.getComputedStyle(pc);
                        const bgImage = style.backgroundImage;
                        if (bgImage && bgImage !== 'none') {
                            // Extract URL from 'url("...")'
                            const match = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
                            if (match && match[1]) {
                                const b64 = await toBase64(match[1]);
                                if (b64) results.push(b64);
                                continue;
                            }
                        }
                    }
                }

                // Strategy 2: Fallback to Canvas
                if (results.length === 0) {
                    console.log('No .pc images found, checking canvases...');
                    const canvases = Array.from(document.querySelectorAll('canvas'));
                    for (const c of canvases) {
                        results.push(c.toDataURL('image/jpeg', 0.5)); // Reduced quality
                    }
                }

                return results;
            });

            console.log(`Found ${imageUrls.length} images/canvases.`);

            await browser.close();

            if (imageUrls.length === 0) {
                console.error('No content found.');
                return NextResponse.json({ error: 'No content found. Ensure the document is visible.' }, { status: 404 });
            }

            // Generate PDF
            console.log(`Generating PDF with ${imageUrls.length} images...`);
            const doc = new jsPDF();

            for (let index = 0; index < imageUrls.length; index++) {
                const imgData = imageUrls[index];
                try {
                    if (index > 0) doc.addPage();

                    if (!imgData || typeof imgData !== 'string') {
                        console.warn(`Skipping image ${index}: Invalid data`);
                        continue;
                    }

                    // Cleanup MIME type if unknown (Fallback approach)
                    let cleanData = imgData;
                    if (cleanData.startsWith('data:;')) {
                        cleanData = cleanData.replace('data:;', 'data:image/jpeg;');
                    }
                    if (!cleanData.startsWith('data:image')) {
                        // If missing header entirely, assume JPEG
                        cleanData = 'data:image/jpeg;base64,' + cleanData;
                    }

                    const imgProps = doc.getImageProperties(cleanData);
                    const pdfWidth = doc.internal.pageSize.getWidth();
                    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

                    doc.addImage(cleanData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
                } catch (pdfErr) {
                    // Try fallback fixed height if standard add failed
                    try {
                        const pdfWidth = doc.internal.pageSize.getWidth();
                        doc.addImage(imageUrls[index], 'JPEG', 0, 0, pdfWidth, 250);
                        console.log(`Recovered image ${index} with direct add`);
                    } catch (e2) {
                        console.error(`Error adding image ${index} to PDF:`, pdfErr);
                    }
                }
            }

            const pdfBuffer = doc.output('arraybuffer');
            console.log(`PDF generated. Size: ${(pdfBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

            return new NextResponse(pdfBuffer, {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': 'attachment; filename="document.pdf"',
                },
            });

        } catch (err) {
            if (browser) await browser.close();
            console.error('Scraping error:', err);
            return NextResponse.json({ error: 'Failed to process document: ' + err.message }, { status: 500 });
        }
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            var totalHeight = 0;
            var distance = 100;
            var timer = setInterval(() => {
                var scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight || totalHeight > 50000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}
