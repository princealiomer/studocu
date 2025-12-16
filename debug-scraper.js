const puppeteer = require('puppeteer');

async function testScraper() {
    const url = 'https://www.studocu.com/row/document/sindh-madressatul-islam-university/software-engineering/project-report-of-software-engineering-on-online-e-commerce-website/9164965';

    console.log('Testing Scraper Logic...');
    console.log(`URL: ${url}`);

    try {
        console.log('Launching Puppeteer...');
        const browser = await puppeteer.launch({
            headless: true,
            // args: ['--no-sandbox', '--disable-setuid-sandbox'] // sometimes needed
        });

        const page = await browser.newPage();
        console.log('Navigating...');

        // Set a user agent just in case
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('Page Loaded.');

        console.log('Scrolling...');
        await autoScroll(page);
        console.log('Scroll done.');

        const canvasCount = await page.evaluate(() => {
            return document.querySelectorAll('canvas').length;
        });

        console.log(`Found ${canvasCount} canvases.`);

        await browser.close();

        if (canvasCount > 0) {
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

testScraper();
