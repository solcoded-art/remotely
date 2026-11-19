// Render the supplied artwork unchanged; native bundles require PNG icon sizes.
const { chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const source = await fs.readFile(path.resolve(__dirname, '../public/icons/remotely-favicon.svg'), 'utf8');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    for (const size of [192, 512, 1024]) {
      const data = await page.evaluate(async ({ source, size }) => {
        const image = new Image(size, size);
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw Error('Could not prepare icon canvas.');
        context.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { source, size });
      await fs.writeFile(path.resolve(__dirname, `../public/icons/icon-${size}.png`), Buffer.from(data, 'base64'));
      console.log(`Rendered ${size}px Remotely icon.`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
