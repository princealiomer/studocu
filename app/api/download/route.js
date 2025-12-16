import { chromium } from 'playwright-core';
import chromiumLambda from 'playwright-aws-lambda';
import { jsPDF } from 'jspdf';
import { NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req) {
    let browser = null;
    try {
        const { url } = await req.json();
        if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

        console.log('Launching Playwright...');

        if (process.env.NODE_ENV === 'development') {
            browser = await chromium.launch({ headless: true });
        } else {
            browser = await chromiumLambda.launchChromium({
                headless: true
            });
        }

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Auto-scroll function adapted for Playwright
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

        console.log('Extracting images...');
        const imageUrls = await page.evaluate(async () => {
            const results = [];

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
                    return canvas.toDataURL('image/jpeg', 0.5);
                } catch (e) { return null; }
            };

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
            return NextResponse.json({ error: 'No content found' }, { status: 404 });
        }

        console.log(`Generating PDF (${imageUrls.length} pages)...`);
        const doc = new jsPDF();
        for (let i = 0; i < imageUrls.length; i++) {
            if (i > 0) doc.addPage();
            const imgProps = doc.getImageProperties(imageUrls[i]);
            const pdfWidth = doc.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            doc.addImage(imageUrls[i], 'JPEG', 0, 0, pdfWidth, pdfHeight);
        }

        const pdfBuffer = doc.output('arraybuffer');
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
}
