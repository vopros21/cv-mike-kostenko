// Renders og/og.html to docs/images/og.png (1200×630) for Open Graph / Twitter previews.
// Reuses the Playwright install from pdf/.  Usage: (cd pdf && npm i) && node og/build.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.join(here, '..', 'pdf', 'package.json'))('playwright');

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: 'light' });
await page.goto(pathToFileURL(path.join(here, 'og.html')).href);
await page.screenshot({ path: path.join(here, '..', 'docs', 'images', 'og.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log('docs/images/og.png written');
