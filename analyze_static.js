const fs = require('fs');

async function analyze() {
    const url = 'https://www.studocu.com/row/document/sindh-madressatul-islam-university/software-engineering/project-report-of-software-engineering-on-online-e-commerce-website/9164965';
    console.log('Fetching raw HTML...');

    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const html = await res.text();

        console.log('HTML Length:', html.length);

        // Check for JSON blobs
        const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
        console.log(`Found ${scriptMatches ? scriptMatches.length : 0} script tags.`);

        if (scriptMatches) {
            scriptMatches.forEach((s, i) => {
                if (s.includes('window.__INITIAL_STATE__') || s.includes('json') || s.includes('9164965')) {
                    console.log(`\n--- Potential Data Script ${i} ---`);
                    console.log(s.substring(0, 500) + '...');

                    // Look for image URLs in this script
                    if (s.includes('.jpg') || s.includes('.png')) {
                        console.log('   -> Contains image potential URLs');
                    }
                }
            });
        }

        // Write to file for manual inspection if needed
        fs.writeFileSync('debug-raw.html', html);
        console.log('Saved debug-raw.html');

    } catch (e) {
        console.error(e);
    }
}

analyze();
