// Renders pdf/cv.html to docs/cv.pdf (A4).  Usage: cd pdf && npm i && npx playwright install chromium && npm run build
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(here, 'cv.html')).href);
await page.pdf({ path: path.join(here, '..', 'docs', 'cv.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log('docs/cv.pdf written');
