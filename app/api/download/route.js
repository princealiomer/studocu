import { chromium as playwrightBrowser } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { jsPDF } from 'jspdf';
import { NextResponse } from 'next/server';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Configuration constants
const MAX_SCROLL_HEIGHT = 100000;
const SCROLL_DISTANCE = 100;
const SCROLL_INTERVAL_MS = 50;
const MAX_SCROLL_TIME_MS = 240000; // 4 minutes

export async function POST(req) {
    let browser = null;
    try {
        const { url } = await req.json();

        // Validate URL is provided
        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        // SSRF Protection: Validate it's a studocu.com URL
        const urlPattern = /^https:\/\/(www\.)?studocu\.com\//i;
        if (!urlPattern.test(url)) {
            return NextResponse.json({
                error: 'Invalid URL. Please provide a valid StudoCu document URL (e.g., https://www.studocu.com/...)'
            }, { status: 400 });
        }

        console.log('Launching Hybrid Playwright...');

        // Use environment variable to control browser mode
        // Set USE_LOCAL_BROWSER=true for local development or Windows production
        const useLocalBrowser = process.env.USE_LOCAL_BROWSER === 'true' ||
            process.env.NODE_ENV === 'development';

        if (useLocalBrowser) {
            console.log('Using Local Playwright Launch...');
            try {
                browser = await playwrightBrowser.launch({
                    headless: true,
                    channel: 'chrome', // Try system Chrome first
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
            } catch (chromeError) {
                console.warn('Chrome channel failed, trying default launch:', chromeError.message);
                browser = await playwrightBrowser.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
            }
        } else {
            console.log('Resolving Sparticuz Config (Serverless/Lambda)...');
            chromium.setGraphicsMode = false;
            const executablePath = await chromium.executablePath();

            browser = await playwrightBrowser.launch({
                args: chromium.args,
                executablePath: executablePath,
                headless: true, // Force boolean true instead of chromium.headless which may return string
            });
        }

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Auto-scroll function with timeout protection
        await page.evaluate(async (config) => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const startTime = Date.now();

                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, config.distance);
                    totalHeight += config.distance;
                    const elapsedTime = Date.now() - startTime;

                    // Stop if: reached bottom, scrolled too far, or timeout
                    if (totalHeight >= scrollHeight ||
                        totalHeight > config.maxHeight ||
                        elapsedTime > config.maxTime) {
                        clearInterval(timer);
                        resolve();
                    }
                }, config.interval);
            });
        }, {
            distance: SCROLL_DISTANCE,
            maxHeight: MAX_SCROLL_HEIGHT,
            maxTime: MAX_SCROLL_TIME_MS,
            interval: SCROLL_INTERVAL_MS
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
