import { expect, test } from '@playwright/test';
import { expectNoSeriousAccessibilityIssues, openPreset } from './helpers';

test.describe('landing page', () => {
  test('states the product, shows a labelled simulated example and passes accessibility checks', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Save the experience, not just the plan.',
    );
    const example = page.getByRole('figure', { name: /example of the gate at work/i });
    await expect(example).toContainText(
      'Simulated demo catalogue (not Qloo data, not real venues)',
    );
    await expect(example.getByText('Ruled out').first()).toBeVisible();
    await expectNoSeriousAccessibilityIssues(page);
  });

  test('opens a simulated example in one press and lands on a shortlist', async ({ page }) => {
    await page.goto('/');
    const run = page.getByRole('button', { name: 'Run a simulated example' });
    await expect(run).toBeEnabled();
    await run.click();
    await expect(page.getByRole('heading', { name: 'Shortlist' })).toBeVisible();
    await expect(page.getByText('Demo mode.')).toBeVisible();
  });

  test('has a skip link that moves focus to the main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to the main content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });
});

test.describe('recovery flow in demo mode', () => {
  test('rules out places that break a requirement, then reaches a user confirmed outcome', async ({
    page,
  }) => {
    await openPreset(page, 's02-vegan-date-budget');

    await expect(page.getByText('Demo mode.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shortlist' })).toBeVisible();

    // The ruled out group is collapsed and holds the places that broke the price ceiling.
    const ruledOut = page.locator('details.ruled-out');
    await ruledOut.locator('summary').click();
    await ruledOut.getByRole('button', { name: /Quillfeather Supper Room/ }).click();
    await expect(
      page.getByRole('complementary', { name: /Quillfeather Supper Room/ }),
    ).toContainText('Price level 3 against a limit of 2');
    // A ruled out place cannot be tried.
    await expect(page.getByRole('button', { name: 'Try this one' })).toHaveCount(0);

    // Pick the top shortlisted place and walk it through to confirmation.
    await page
      .locator('.option-group')
      .filter({ hasText: 'Shortlist' })
      .getByRole('button')
      .first()
      .click();
    await page.getByRole('button', { name: 'Try this one' }).click();
    await expect(page.getByText('Attempt under way').first()).toBeVisible();
    await page.getByRole('button', { name: 'It is confirmed' }).click();
    await expect(page.getByText('Confirmed by you').first()).toBeVisible();
    await expect(page.getByText(/did not verify it with the venue/)).toBeVisible();

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('list', { name: 'Case history' })).toContainText(
      'This is your attestation, not an automatic booking',
    );
    await expectNoSeriousAccessibilityIssues(page);
  });

  test('asks the person to choose when a signal is ambiguous and does not guess', async ({
    page,
  }) => {
    await page.goto('/#/new?scenario=s00-jazz-needs-a-choice');
    await expect(page.getByLabel('Title')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Open the case and find options' }).click();

    await expect(page.getByRole('heading', { name: /Your input is needed/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shortlist' })).toHaveCount(0);
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Use this match' }).click();
    await expect(page.getByRole('heading', { name: 'Shortlist' })).toBeVisible();
  });

  test('offers ways forward, and waits, when no place meets every requirement', async ({
    page,
  }) => {
    await openPreset(page, 's10-no-feasible-option');
    await expect(
      page.getByRole('heading', { name: 'No place meets every requirement' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shortlist' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Yes, give this up' }).first().click();
    await expect(page.getByRole('heading', { name: 'Shortlist' })).toBeVisible();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('list', { name: 'Case history' })).toContainText(
      'The anchor is unchanged',
    );
  });

  test('shows the taste on and taste off comparison over the same eligible places', async ({
    page,
  }) => {
    await openPreset(page, 's02-vegan-date-budget');
    await page.getByRole('link', { name: 'Taste on and off' }).click();
    await expect(
      page.getByText('Every order uses the same places and the same gate.'),
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: /nearest first against with taste/i }),
    ).toBeVisible();
    await expect(page.getByText('How the recovery score works')).toBeVisible();
  });

  test('compares taste with the most popular order as well as the nearest first order', async ({
    page,
  }) => {
    await openPreset(page, 's02-vegan-date-budget');
    await page.getByRole('link', { name: 'Taste on and off' }).click();
    await expect(
      page.getByRole('heading', { name: 'Top three, most popular first' }),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Most popular first' }).check();
    await expect(
      page.getByRole('img', { name: /most popular first against with taste/i }),
    ).toBeVisible();
    await expectNoSeriousAccessibilityIssues(page);
  });

  test('shows what the agent observed, planned, did and decided, and where it stopped', async ({
    page,
  }) => {
    await openPreset(page, 's02-vegan-date-budget');
    await page.getByRole('link', { name: 'Agent trace' }).click();
    await expect(page.getByRole('heading', { name: 'How the agent worked' })).toBeVisible();
    await expect(page.getByText('It is not a chat model')).toBeVisible();

    const cycle = page.getByRole('listitem').filter({ hasText: 'Cycle 1. First search' });
    await expect(cycle).toBeVisible();
    for (const phase of ['Observed', 'Planned', 'Did', 'Decided', 'Handed back']) {
      await expect(cycle.getByText(phase, { exact: true })).toBeVisible();
    }
    await expect(cycle).toContainText('Checked every place against every requirement');
    await expect(cycle).toContainText('does not book, call or pay');
    await expect(cycle).toContainText('Simulated');
    await expectNoSeriousAccessibilityIssues(page);
  });

  test('lists the redacted evidence for a case', async ({ page }) => {
    await openPreset(page, 's02-vegan-date-budget');
    await page.getByRole('link', { name: 'Evidence' }).nth(1).click();
    await expect(page.getByRole('heading', { name: /What was sent to/ })).toBeVisible();
    await expect(page.getByText('Kept on this server only')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/x-api-key/i);
  });
});

test.describe('integration status honesty', () => {
  test('says live Qloo is off and that no live test is recorded', async ({ page }) => {
    await page.goto('/#/evidence');
    await expect(page.getByText(/No Qloo API key is configured on this server/)).toBeVisible();
    await expect(page.getByText(/No live smoke test result is recorded/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check the connection' })).toBeDisabled();
    await expect(page.getByText('Offline evaluation on the simulated catalogue')).toBeVisible();
    await expectNoSeriousAccessibilityIssues(page);

    await page.goto('/#/new');
    await expect(page.getByRole('radio', { name: /Live Qloo/ })).toBeDisabled();
  });
});

test.describe('small screens', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const hash of ['/', '/#/new', '/#/evidence', '/#/cases']) {
    test(`does not scroll sideways at ${hash}`, async ({ page }) => {
      await page.goto(hash);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
    });
  }
});
