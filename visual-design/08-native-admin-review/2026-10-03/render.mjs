import { mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.PLAYWRIGHT_BROWSERS_PATH = 'D:\\app-m3-cache\\teacher\\playwright';
process.env.TEMP = 'D:\\app-m3-cache\\teacher\\tmp';
process.env.TMP = process.env.TEMP;
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/18167/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = dirname(fileURLToPath(import.meta.url));
const viewports = [
  { width: 390, height: 844, folder: 'png' },
  { width: 375, height: 812, folder: 'png-375' },
];
const pages = ['A-01','A-02','A-03','A-04','A-05','A-06','A-07','A-08',
  'no-access','conflict','media-reject','revoke'];
const url = pathToFileURL(join(root, 'index.html')).href;
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const output = join(root, viewport.folder);
    await mkdir(output, { recursive: true });
    const tab = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2 });
    for (const page of pages) {
      const destination = join(output, `${page}.png`);
      await tab.goto(`${url}?page=${page}`, { waitUntil: 'load' });
      const overflow = await tab.evaluate(() => [...document.querySelectorAll('body *')]
        .filter(element => element.getBoundingClientRect().right > innerWidth + 1)
        .map(element => ({ tag: element.tagName, className: element.className,
          right: Math.round(element.getBoundingClientRect().right) })));
      if (overflow.length) throw new Error(`${page} ${viewport.width}px horizontal overflow: ${JSON.stringify(overflow.slice(0, 3))}`);
      await tab.screenshot({ path: destination });
      const file = await stat(destination);
      if (file.size < 5000) throw new Error(`${page} screenshot unexpectedly small`);
      process.stdout.write(`${viewport.width} ${page}\t${file.size}\n`);
      if (page.startsWith('A-')) {
        const hasLowerContent = await tab.locator('.scroll').evaluate(element => {
          const scroll = element;
          if (scroll.scrollHeight <= scroll.clientHeight + 5) return false;
          scroll.scrollTop = scroll.scrollHeight;
          return scroll.scrollTop > 0;
        });
        if (hasLowerContent) {
          const lower = join(output, `${page}-lower.png`);
          await tab.screenshot({ path: lower });
          if ((await stat(lower)).size < 5000) throw new Error(`${page} lower screenshot unexpectedly small`);
        }
      }
    }
    await tab.close();
  }
  const gallery = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await gallery.goto(pathToFileURL(join(root, 'gallery.html')).href, { waitUntil: 'load' });
  const cards = await gallery.locator('.image-card').count();
  if (cards !== 40) throw new Error(`gallery expected 40 image links, got ${cards}`);
  await gallery.close();
} finally {
  await browser.close();
}
