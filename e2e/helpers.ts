import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectNoSeriousAccessibilityIssues(page: Page): Promise<void> {
  // The landing example fades in. Contrast is judged on the settled page, not mid fade.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`),
    'serious or critical accessibility violations',
  ).toEqual([]);
}

export async function openPreset(page: Page, scenarioId: string): Promise<void> {
  await page.goto(`/#/new?scenario=${scenarioId}`);
  await expect(page.getByLabel('Title')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Open the case and find options' }).click();
  await expect(page.getByRole('navigation', { name: 'Recovery progress' })).toBeVisible();
}
