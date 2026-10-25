// Captures the documentation screenshots from a running server in demo mode.
//   npm run build && npm start        (in one terminal)
//   node scripts/screenshots.mjs      (in another)
// Every case screenshot shows the simulated demo catalogue. The live evaluation screenshot shows recorded
// results with no venue data. None contains a credential or personal data.
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const base = process.env.AFTERGLOW_URL ?? 'http://127.0.0.1:8788';
const out = new URL('../docs/screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({
  viewport: { width: 1280, height: 820 },
  colorScheme: 'light',
  reducedMotion: 'reduce',
});
const page = await context.newPage();

await page.goto(`${base}/`);
await page.waitForSelector('.vignette');
await page.screenshot({ path: `${out}01-landing.png` });

await page.goto(`${base}/#/new?scenario=s02-vegan-date-budget`);
await expect(page.getByLabel('Title')).not.toHaveValue('');
await page.screenshot({ path: `${out}02-intake.png` });

await page.getByRole('button', { name: 'Open the case and find options' }).click();
await page.waitForSelector('.horizon');
await page.waitForSelector('.option-list');
await page.screenshot({ path: `${out}03-recovery.png` });

await page.locator('details.ruled-out summary').click();
await page.locator('details.ruled-out').getByRole('button').first().click();
await page.locator('#inspector').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}04-ruled-out.png` });

await page.getByRole('link', { name: 'Taste on and off' }).click();
await page.waitForSelector('.slope');
await page.screenshot({ path: `${out}05-comparison.png` });

await page.getByRole('link', { name: 'Agent trace' }).click();
await page.waitForSelector('.trace-cycle');
await page.screenshot({ path: `${out}07-agent-trace.png`, fullPage: true });

await page.goto(`${base}/#/evidence`);
await page.waitForSelector('text=Qloo connection');
await page.screenshot({ path: `${out}06-evidence.png` });

await page.getByRole('heading', { name: 'Live evaluation on Qloo data' }).waitFor();
await page
  .locator('section[aria-labelledby="ev-live"]')
  .screenshot({ path: `${out}08-live-evaluation.png` });

await browser.close();
console.log(`Screenshots written to ${out}`);
