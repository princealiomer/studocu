import { chromium as playwrightBrowser } from 'playwright-core';
import puppeteer from 'puppeteer-core';
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

        console.log('Launching Browser...');

        // Use environment variable to control browser mode
        // Set USE_LOCAL_BROWSER=true for local development or Windows production
        const useLocalBrowser = process.env.USE_LOCAL_BROWSER === 'true' ||
            process.env.NODE_ENV === 'development';

        let page;

        if (useLocalBrowser) {
            console.log('Using Local Playwright Launch...');
            try {
                browser = await playwrightBrowser.launch({
                    headless: true,
                    channel: 'chrome',
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
            } catch (chromeError) {
                console.warn('Chrome channel failed, trying default launch:', chromeError.message);
                browser = await playwrightBrowser.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
            }
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
            });
            page = await context.newPage();
        } else {
            // Serverless: Use Puppeteer with @sparticuz/chromium (they're compatible)
            console.log('Using Puppeteer with Sparticuz Chromium (Serverless)...');

            const executablePath = await chromium.executablePath();
            console.log('Chromium executable path:', executablePath);

            browser = await puppeteer.launch({
                args: [...chromium.args, '--disable-dev-shm-usage'],
                executablePath: executablePath,
                headless: 'shell', // Use 'shell' mode for v143+
            });
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');
        }

        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Extract page title for filename
        console.log('Extracting page title...');
        const pageTitle = await page.evaluate(() => {
            // Try multiple selectors for title
            const titleElement = document.querySelector('h1[data-testid="document-title"]') ||
                document.querySelector('h1.title') ||
                document.querySelector('h1') ||
                document.querySelector('meta[property="og:title"]');

            let title;
            if (titleElement?.tagName === 'META') {
                title = titleElement.getAttribute('content');
            } else {
                title = titleElement?.textContent?.trim();
            }

            if (!title) {
                title = document.title;
            }

            // Sanitize filename: remove invalid characters and limit length
            title = title.replace(/[<>:"/\\|?*]/g, '-').substring(0, 100).trim();
            return title || 'studocu-document';
        });
        console.log('Page title:', pageTitle);

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

        console.log('Extracting content...');
        let imageUrls = [];

        // Try to capture using element screenshots (preserves text overlays)
        if (useLocalBrowser) {
            // Playwright approach
            console.log('Using Playwright screenshot method...');
            try {
                const pageContainers = await page.$$('.pc, .page-container, [class*="page"]');
                console.log(`Found ${pageContainers.length} page containers`);

                for (const container of pageContainers) {
                    await container.scrollIntoViewIfNeeded();
                    await page.waitForTimeout(100);
                    const screenshot = await container.screenshot({ type: 'jpeg', quality: 90 });
                    const base64 = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
                    imageUrls.push(base64);
                }
            } catch (screenshotError) {
                console.warn('Screenshot method failed, falling back to evaluate:', screenshotError.message);
            }
        } else {
            // Puppeteer approach
            console.log('Using Puppeteer screenshot method...');
            try {
                const pageContainers = await page.$$('.pc, .page-container, [class*="page"]');
                console.log(`Found ${pageContainers.length} page containers`);

                for (const container of pageContainers) {
                    await container.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
                    await page.waitForTimeout(100);
                    const screenshot = await container.screenshot({ type: 'jpeg', quality: 90 });
                    const base64 = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
                    imageUrls.push(base64);
                }
            } catch (screenshotError) {
                console.warn('Screenshot method failed, falling back to evaluate:', screenshotError.message);
            }
        }

        // Fallback: Use original image extraction method
        if (imageUrls.length === 0) {
            console.log('Using fallback image extraction method...');
            imageUrls = await page.evaluate(async () => {
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
                        return canvas.toDataURL('image/jpeg', 0.9);
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
                        results.push(c.toDataURL('image/jpeg', 0.9));
                    }
                }
                return results;
            });
        }

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
        const sanitizedTitle = pageTitle || 'studocu-document';

        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${sanitizedTitle}.pdf"`,
                'X-Document-Title': sanitizedTitle,
            },
        });

    } catch (err) {
        if (browser) await browser.close();
        console.error(err);
        return NextResponse.json({ error: 'Server Error: ' + err.message }, { status: 500 });
    }
}
