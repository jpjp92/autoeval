import { test, expect, type Page } from '@playwright/test';

// Mobile < 1024px uses the bottom tab bar; desktop keeps the Sidebar.
const MOBILE_WIDTHS = [360, 375, 390, 430];
const DESKTOP_WIDTHS = [1024, 1440];
const TABS = ['Dashboard', 'Documents', 'QA Pipeline', 'Evaluation'];

// Elements whose box leaves the viewport horizontally, ignoring content that
// sits inside its own horizontal scroll container (wide tables, charts).
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const scrollsX = (el: Element | null) => {
      for (let n = el?.parentElement; n; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth) return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.position === 'fixed') continue;
      if (el.closest('[aria-hidden="true"]')) continue; // decorative backgrounds
      if ((r.right > vw + 1 || r.left < -1) && !scrollsX(el)) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40);
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} [${Math.round(r.left)}..${Math.round(r.right)}] ${label}`);
      }
    }
    return {
      docOverflow: document.documentElement.scrollWidth - vw,
      offenders: offenders.slice(0, 10),
    };
  });
}

for (const width of MOBILE_WIDTHS) {
  test.describe(`mobile ${width}px`, () => {
    test.use({ viewport: { width, height: 812 }, hasTouch: true, isMobile: true });

    test('tab bar replaces the sidebar and no tab overflows horizontally', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const tabbar = page.getByRole('navigation', { name: 'Main navigation' });
      await expect(tabbar).toHaveCount(1);
      await expect(tabbar).toBeVisible();

      for (const name of TABS) {
        const tab = tabbar.getByRole('button', { name, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-current', 'page');
        const box = await tab.boundingBox();
        expect(box!.height, `${name} tap target`).toBeGreaterThanOrEqual(44);

        const result = await horizontalOverflow(page);
        expect(result.docOverflow, `${name} document overflow`).toBeLessThanOrEqual(0);
        expect(result.offenders, `${name} offenders`).toEqual([]);
      }
    });

    test('evaluation report from history fits the viewport', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Evaluation', exact: true }).click();
      const historyButton = page.getByRole('button', { name: /History/ }).first();
      const hasHistory = await historyButton.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
      test.skip(!hasHistory, 'no evaluation history in this environment');
      await historyButton.click();
      const menu = page.locator('[data-role="history-menu"]');
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
      await menu.getByRole('button').first().click();

      await expect(page.getByText('QA 성능 평가 리포트')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('상세 평가 결과')).toBeVisible();
      // Mobile shows the card list, not the wide table.
      await expect(page.locator('table')).toBeHidden();
      let result = await horizontalOverflow(page);
      expect(result.docOverflow).toBeLessThanOrEqual(0);
      expect(result.offenders, 'report offenders').toEqual([]);

      // Info tooltips open on tap and stay inside the viewport.
      const info = page.getByRole('button', { name: /설명$/ }).first();
      await info.tap();
      const tip = page.getByRole('tooltip').filter({ visible: true }).first();
      await expect(tip).toBeVisible();
      const tipBox = (await tip.boundingBox())!;
      expect(tipBox.x).toBeGreaterThanOrEqual(0);
      expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');

      const firstCard = page.locator('ul.md\\:hidden > li button').first();
      if (await firstCard.isVisible().catch(() => false)) {
        await firstCard.click();
        result = await horizontalOverflow(page);
        expect(result.offenders, 'detail view offenders').toEqual([]);
      }
    });

    test('notification panel stays inside the viewport', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Notifications' }).click();
      const panel = page.getByRole('dialog', { name: 'Notifications' });
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    });
  });
}

for (const width of DESKTOP_WIDTHS) {
  test.describe(`desktop ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('sidebar navigation remains and tab bar is hidden', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      await expect(nav).toHaveCount(1);
      await expect(nav).toHaveAttribute('id', 'sidebar-navigation');
      for (const name of TABS) {
        await nav.getByRole('button', { name, exact: true }).click();
        const result = await horizontalOverflow(page);
        expect(result.docOverflow, `${name} document overflow`).toBeLessThanOrEqual(0);
      }
    });
  });
}
