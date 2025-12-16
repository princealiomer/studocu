const puppeteer = require('puppeteer');

async function testScraper() {
    const url = 'https://www.studocu.com/row/document/sindh-madressatul-islam-university/software-engineering/project-report-of-software-engineering-on-online-e-commerce-website/9164965';

    console.log('Testing Scraper Logic...');
    console.log(`URL: ${url}`);

    try {
        console.log('Launching Puppeteer...');
        const browser = await puppeteer.launch({
            headless: false, // Changed to false to see what happens
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        console.log('Navigating...');

        // Set a user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Changed to domcontentloaded which is faster/safer
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('Page Loaded. Waiting for content...');

        // Wait for specific content to ensure page is ready
        try {
            await page.waitForSelector('.pc', { timeout: 10000 });
        } catch (e) {
            console.log('Warning: .pc selector not found immediately, scrolling anyway...');
        }

        console.log('Scrolling...');
        await autoScroll(page);
        console.log('Scroll done.');

        // Verify content using same logic as route.js
        const contentCount = await page.evaluate(() => {
            const pcs = document.querySelectorAll('.pc');
            let count = 0;
            pcs.forEach(pc => {
                const img = pc.querySelector('img');
                const style = window.getComputedStyle(pc);
                const bg = style.backgroundImage;
                if ((img && img.src) || (bg && bg.includes('url'))) {
                    count++;
                }
            });
            // Fallback to canvas
            if (count === 0) {
                return document.querySelectorAll('canvas').length;
            }
            return count;
        });

        console.log(`Found ${contentCount} pages/content items.`);

        await browser.close();

        if (contentCount > 0) {
            console.log('SUCCESS: Scraper found content.');
        } else {
            console.error('FAILURE: No content found.');
        }

    } catch (error) {
        console.error('CRASH:', error);
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
                // Increased max scroll height limit
                if (totalHeight >= scrollHeight || totalHeight > 100000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 50); // Faster scroll
        });
    });
}

testScraper();
