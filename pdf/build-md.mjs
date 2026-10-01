// Generates docs/cv.md from pdf/cv.html so the plain-text CV stays in sync with the PDF.
// Usage: cd pdf && npm i && npm run build   (or: node build-md.mjs)
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(here, 'cv.html')).href);

const md = await page.evaluate(() => {
  const clean = s => s.replace(/\s+/g, ' ');

  // Inline content: **bold**, [links](href), plain text
  const inline = node => [...node.childNodes].map(n => {
    if (n.nodeType === Node.TEXT_NODE) return clean(n.textContent);
    if (n.nodeType !== Node.ELEMENT_NODE) return '';
    const text = inline(n);
    if (n.tagName === 'STRONG' || n.tagName === 'B') return `**${text.trim()}**`;
    if (n.tagName === 'A') return `[${text.trim()}](${n.getAttribute('href')})`;
    return text;
  }).join('');
  const line = el => inline(el).replace(/\s+/g, ' ').trim();

  const out = [];
  const block = el => {
    switch (el.tagName) {
      case 'H1': out.push(`# ${line(el)}`, ''); return;
      case 'H2': out.push(`## ${line(el)}`, ''); return;
      case 'H3': out.push(`### ${line(el)}`, ''); return;
      case 'UL': case 'OL':
        [...el.children].forEach(li => out.push(`- ${line(li)}`));
        out.push(''); return;
      case 'P':
        if (el.classList.contains('role')) out.push(`**${line(el)}**`, '');
        // grouped lines (e.g. skills) read better as a list
        else if (el.parentElement.classList.contains('skills')) {
          out.push(`- ${line(el)}`);
          if (el.nextElementSibling?.tagName !== 'P') out.push('');
        } else out.push(line(el), '');
        return;
      default:
        [...el.children].forEach(block);
    }
  };
  block(document.querySelector('.page'));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
});

await browser.close();
await writeFile(path.join(here, '..', 'docs', 'cv.md'), md);
console.log('docs/cv.md written');
