import { test, expect, type Page } from '@playwright/test';

const OPEN = '설정 열기';
const BACK = '이전 화면으로 돌아가기';
const TABS = ['Dashboard', 'Documents', 'QA Pipeline', 'Evaluation'];

const tabbar = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });
const activeTab = (page: Page) => tabbar(page).locator('button[aria-current="page"]');

async function open(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

test.describe('mobile Settings toggle (375px)', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('header button toggles Settings and returns to the previous tab', async ({ page }) => {
    await open(page);
    for (const name of TABS) {
      await tabbar(page).getByRole('button', { name, exact: true }).click();
      await page.getByRole('button', { name: OPEN }).click();
      await expect(activeTab(page)).toHaveCount(0);
      const back = page.getByRole('button', { name: BACK });
      await expect(back).toBeVisible();
      await back.click();
      await expect(activeTab(page)).toHaveText(name);
      await expect(page.getByRole('button', { name: OPEN })).toBeVisible();
    }
  });

  test('a tab chosen from Settings becomes the return target', async ({ page }) => {
    await open(page);
    await tabbar(page).getByRole('button', { name: 'Documents', exact: true }).click();
    await page.getByRole('button', { name: OPEN }).click();
    await tabbar(page).getByRole('button', { name: 'Evaluation', exact: true }).click();
    await expect(activeTab(page)).toHaveText('Evaluation');
    await page.getByRole('button', { name: OPEN }).click();
    await page.getByRole('button', { name: BACK }).click();
    await expect(activeTab(page)).toHaveText('Evaluation');
  });

  test('rapid clicks never leave the return target on Settings', async ({ page }) => {
    await open(page);
    await tabbar(page).getByRole('button', { name: 'QA Pipeline', exact: true }).click();
    const btn = page.locator('header button[aria-label="설정 열기"], header button[aria-label="이전 화면으로 돌아가기"]');
    for (let i = 0; i < 5; i++) await btn.click({ delay: 0 }); // odd count ends on Settings
    await expect(page.getByRole('button', { name: BACK })).toBeVisible();
    await page.getByRole('button', { name: BACK }).click();
    await expect(activeTab(page)).toHaveText('QA Pipeline');
  });

  test('browser Back closes Settings', async ({ page }) => {
    await open(page);
    await tabbar(page).getByRole('button', { name: 'Documents', exact: true }).click();
    await page.getByRole('button', { name: OPEN }).click();
    await page.goBack();
    await expect(activeTab(page)).toHaveText('Documents');
    await expect(page.getByRole('button', { name: OPEN })).toBeVisible();
  });

  test('each tab keeps its own scroll position', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 480 }); // make Dashboard scrollable
    await open(page);
    const main = page.locator('main');
    await tabbar(page).getByRole('button', { name: 'Dashboard', exact: true }).click();
    const max = await main.evaluate(el => el.scrollHeight - el.clientHeight);
    test.skip(max < 100, 'Dashboard is too short to scroll');
    await main.evaluate(el => { el.scrollTop = 100; });
    await tabbar(page).getByRole('button', { name: 'Documents', exact: true }).click();
    expect(await main.evaluate(el => el.scrollTop)).toBe(0);
    await tabbar(page).getByRole('button', { name: 'Dashboard', exact: true }).click();
    expect(await main.evaluate(el => el.scrollTop)).toBe(100);
  });
});

test.describe('desktop Settings (1440px)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('sidebar Settings still navigates and the mobile toggle is hidden', async ({ page }) => {
    await open(page);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const settings = page.getByRole('button', { name: 'Settings', exact: true }); // below the nav list
    await settings.click();
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: BACK })).toBeHidden();
    await nav.getByRole('button', { name: 'Evaluation', exact: true }).click();
    await expect(nav.getByRole('button', { name: 'Evaluation', exact: true })).toHaveAttribute('aria-current', 'page');
  });
});
