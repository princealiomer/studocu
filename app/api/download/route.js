import chromium from '@sparticuz/chromium';
import puppeteerCore from 'puppeteer-core';
import puppeteer from 'puppeteer'; // Local fallback
import { jsPDF } from 'jspdf';
import { NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const { url } = await req.json();

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        let browser;
        try {
            console.log('Starting Scraper...');

            // Local Development (Windows/Mac)
            if (process.env.NODE_ENV === 'development') {
                console.log('Launching local browser...');
                browser = await puppeteer.launch({
                    headless: true,
                });
            }
            // Vercel / Production (Linux Serverless)
            else {
                console.log('Launching serverless chromium...');
                // Aggressive cleanup for Vercel stability
                chromium.setGraphicsMode = false;

                browser = await puppeteerCore.launch({
                    args: [
                        ...chromium.args,
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process'
                    ],
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
                    ignoreHTTPSErrors: true,
                });
            }

            const page = await browser.newPage();
            // Stealth Header
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');

            console.log(`Navigating to ${url}...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            console.log('Scrolling...');
            await autoScroll(page);

            console.log('Extracting images...');
            const imageUrls = await page.evaluate(async () => {
                const results = [];

                // Helper: Download and Compress Image using Canvas
                const toBase64 = async (url) => {
                    try {
                        const response = await fetch(url);
                        const blob = await response.blob();
                        const bitmap = await createImageBitmap(blob);

                        const canvas = document.createElement('canvas');
                        canvas.width = bitmap.width;
                        canvas.height = bitmap.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(bitmap, 0, 0);

                        // Force JPEG 0.5 Quality (Fixes Size & Type errors)
                        return canvas.toDataURL('image/jpeg', 0.5);
                    } catch (e) {
                        return null;
                    }
                };

                // 1. Target .pc (Page Container) images
                const pcs = Array.from(document.querySelectorAll('.pc'));
                for (const pc of pcs) {
                    const img = pc.querySelector('img');
                    if (img && img.src) {
                        const b64 = await toBase64(img.src);
                        if (b64) results.push(b64);
                        continue;
                    }

                    const style = window.getComputedStyle(pc);
                    const bg = style.backgroundImage;
                    const match = bg && bg.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match && match[1]) {
                        const b64 = await toBase64(match[1]);
                        if (b64) results.push(b64);
                    }
                }

                // 2. Fallback: Target Canvas elements
                if (results.length === 0) {
                    const canvases = Array.from(document.querySelectorAll('canvas'));
                    for (const c of canvases) {
                        results.push(c.toDataURL('image/jpeg', 0.5));
                    }
                }

                return results;
            });

            await browser.close();

            if (imageUrls.length === 0) {
                return NextResponse.json({ error: 'No content found.' }, { status: 404 });
            }

            console.log(`Generating PDF (${imageUrls.length} pages)...`);
            const doc = new jsPDF();

            for (let i = 0; i < imageUrls.length; i++) {
                try {
                    if (i > 0) doc.addPage();
                    const imgProps = doc.getImageProperties(imageUrls[i]);
                    const pdfWidth = doc.internal.pageSize.getWidth();
                    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
                    doc.addImage(imageUrls[i], 'JPEG', 0, 0, pdfWidth, pdfHeight);
                } catch (e) {
                    // Skip invalid images silently to ensure PDF delivery
                }
            }

            const pdfBuffer = doc.output('arraybuffer');
            console.log(`PDF Done: ${(pdfBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

            return new NextResponse(pdfBuffer, {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': 'attachment; filename="document.pdf"',
                },
            });

        } catch (err) {
            if (browser) await browser.close();
            console.error(err);
            return NextResponse.json({ error: 'Server Error: ' + err.message }, { status: 500 });
        }
    } catch (e) {
        return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
    }
}

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
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
