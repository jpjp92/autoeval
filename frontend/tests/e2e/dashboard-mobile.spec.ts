import { test, expect, type Page, type Locator } from '@playwright/test';

// Dashboard pipeline log + model comparison with deliberately long values.
// /api/dashboard/metrics is mocked so the layout is checked against worst cases.
const LONG_MODELS = [
  'gpt-5.2-2025-12-11',
  'gemini-3-flash-preview-experimental-long-context-0611',
  'claude-sonnet-4-6',
];
const LONG_DOCS = [
  '2026년_식품산업_시장동향_및_소비자_행태_분석_최종보고서_수정본_v3.pdf',
  'gemini-for-enterprise-research-report-with-a-very-long-english-filename-2026.pdf',
  '240229 식품산업 분석.pdf',
];
const GRADES = ['A+', 'A', 'B+', null];

const jobs = Array.from({ length: 12 }, (_, i) => ({
  job_id: `gen_20261110_2330${String(i).padStart(2, '0')}_795636`,
  source_doc: LONG_DOCS[i % LONG_DOCS.length],
  model: LONG_MODELS[i % LONG_MODELS.length],
  total_qa: 1000 + i * 37,
  eval_id: GRADES[i % GRADES.length] ? `eval-${i}` : null,
  eval_grade: GRADES[i % GRADES.length],
  eval_score: 0.9,
  created_at: new Date(Date.now() - i * 3_600_000).toISOString(),
}));

const metrics = {
  success: true,
  data: {
    summary: { total_qa: 12345, avg_final_score: 0.95, total_documents: 3, total_evaluations: 9 },
    recent_jobs: jobs,
    grade_distribution: { 'A+': 3, A: 3, 'B+': 3 },
    score_trend: [],
    model_benchmarks: LONG_MODELS.map((model, i) => ({
      model, avg_score: 0.96 - i * 0.01, pass_rate: 100, run_count: [12, 1, 35][i],
      total_qa: [394, 76, 1153][i], valid_qa: [394, 76, 1153][i],
    })),
  },
};

async function openDashboard(page: Page, theme: 'dark' | 'light' = 'dark', body: object = metrics) {
  await page.route('**/api/dashboard/metrics', r => r.fulfill({ json: body }));
  await page.addInitScript(t => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Desktop shows the table, mobile the card list; wait for whichever renders.
  await page.locator('[data-role="job-list"], table tbody tr').first().waitFor({ timeout: 20_000 });
}

const SIX_MODELS = ['gpt-5.2-2025-12-11', 'gemini-3.8-flash', 'gemini-3-flash-preview', 'claude-sonnet-4-6', 'gpt-6-luna', 'gemini-3.7-flash'];
const sixModelMetrics = {
  ...metrics,
  data: {
    ...metrics.data,
    model_benchmarks: SIX_MODELS.map((model, i) => ({
      model, avg_score: 0.96 - i * 0.01, pass_rate: 100, run_count: i + 1, total_qa: 100, valid_qa: 100,
    })),
  },
};

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

// Every pair of direct visual parts inside `scope` must not overlap, and all must stay in the viewport.
async function expectNoCollisions(scope: Locator, selector: string, label: string) {
  const vw = scope.page().viewportSize()!.width;
  const boxes = await scope.locator(selector).evaluateAll(els =>
    els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })
  );
  for (const b of boxes) {
    expect(b.x, `${label} left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.width, `${label} right edge`).toBeLessThanOrEqual(vw + 0.5);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      expect(overlaps(boxes[i], boxes[j]), `${label} parts ${i}/${j} overlap`).toBe(false);
}

for (const width of [360, 375, 390, 430]) {
  test.describe(`dashboard ${width}px`, () => {
    test.use({ viewport: { width, height: 812 }, hasTouch: true, isMobile: true });

    for (const theme of ['dark', 'light'] as const) {
      test(`log cards and model comparison do not collide (${theme})`, async ({ page }) => {
        await openDashboard(page, theme);
        const list = page.locator('[data-role="job-list"]');
        await expect(list).toBeVisible();
        await expect(page.locator('table').first()).toBeHidden();

        const items = list.locator('> li');
        await expect(items).toHaveCount(5);
        for (let i = 0; i < 5; i++) {
          const item = items.nth(i);
          // row1: document name only (grade moved to ⓘ); row2: model + "QA · time"; plus the detail button
          await expect(item.locator('[data-part="row1"] > *')).toHaveCount(1);
          await expectNoCollisions(item, '[data-part="row2"] > *', `log ${i} row2`);
          await expectNoCollisions(item, '[data-part="row1"], [data-part="row2"], button[aria-label="작업 상세 정보"]', `log ${i}`);
        }

        const headers = page.locator('[data-role="bench-header"]');
        await expect(headers).toHaveCount(3);
        for (let i = 0; i < 3; i++) {
          const h = headers.nth(i);
          await expectNoCollisions(h, '[data-part="bench-rank"], [data-part="bench-name"], [data-part="bench-meta"] > *', `bench ${i}`);
          await expect(h).toContainText('회 테스트');
        }
        await expect(headers.first()).toContainText('Best');
        await expect(headers.first()).toContainText('GPT-5.2');

        const doc = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(doc).toBeLessThanOrEqual(0);
      });
    }

    test('content at the end of the scroll is not covered by the tab bar', async ({ page }) => {
      await openDashboard(page);
      const main = page.locator('main');
      await main.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const tabTop = await page.getByRole('navigation', { name: 'Main navigation' })
        .evaluate(el => el.getBoundingClientRect().top);
      // Last visible block inside the active tab.
      const lastBottom = await main.evaluate(el => {
        const panel = Array.from(el.querySelectorAll(':scope > * > div')).find(d => !d.classList.contains('hidden'));
        const blocks = panel ? Array.from(panel.querySelectorAll('*')) : [];
        return Math.max(...blocks.map(b => b.getBoundingClientRect()).filter(r => r.height > 0).map(r => r.bottom));
      });
      expect(lastBottom).toBeLessThanOrEqual(tabTop + 0.5);
    });

    test('model comparison shows the top 4 and unfolds the rest', async ({ page }) => {
      await openDashboard(page, 'dark', sixModelMetrics);
      const headers = page.locator('[data-role="bench-header"]');
      await expect(headers).toHaveCount(4);
      await expect(headers.nth(3)).toContainText('Claude Sonnet 4.6');
      const more = page.getByRole('button', { name: '나머지 2개 모델 보기' });
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await more.click();
      await expect(headers).toHaveCount(6);
      await expect(headers.nth(4)).toContainText('GPT-6 Luna'); // rank 5 follows rank 4
      await page.getByRole('button', { name: '접기' }).click();
      await expect(headers).toHaveCount(4);
      const doc = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(doc).toBeLessThanOrEqual(0);
    });

    test('no fold button with 4 or fewer models', async ({ page }) => {
      await openDashboard(page); // 3 models
      await expect(page.locator('[data-role="bench-header"]')).toHaveCount(3);
      await expect(page.getByRole('button', { name: /모델 보기|접기/ })).toHaveCount(0);
    });

    test('detail shows full IDs without opening the evaluation', async ({ page }) => {
      await openDashboard(page);
      const first = page.locator('[data-role="job-list"] > li').first();
      await first.getByRole('button', { name: '작업 상세 정보' }).click();
      const detail = first.locator('[data-role="job-detail"]');
      await expect(detail).toContainText(jobs[0].job_id);
      await expect(detail).toContainText(jobs[0].model);
      await expect(detail.locator('[data-part="detail-grade"]')).toHaveText(jobs[0].eval_grade!);
      // A job without an evaluation shows "대기" in the detail.
      const pending = page.locator('[data-role="job-list"] > li').nth(3); // GRADES[3] is null
      await pending.getByRole('button', { name: '작업 상세 정보' }).click();
      await expect(pending.locator('[data-part="detail-grade"]')).toHaveText('대기');
      // Still on the dashboard: the detail tap did not trigger evaluation navigation.
      await expect(page.getByRole('navigation', { name: 'Main navigation' })
        .locator('button[aria-current="page"]')).toHaveText('Dashboard');
      await expect(detail).toBeHidden(); // one detail open at a time
      const box = await pending.locator('[data-role="job-detail"]').boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
    });

    test('tapping a log card opens its evaluation', async ({ page }) => {
      await openDashboard(page);
      await page.locator('[data-role="job-list"] > li').first().locator('button').first().click();
      await expect(page.getByRole('navigation', { name: 'Main navigation' })
        .locator('button[aria-current="page"]')).toHaveText('Evaluation');
    });

    test('sorting and pagination work on the card list', async ({ page }) => {
      await openDashboard(page);
      const firstMeta = page.locator('[data-role="job-list"] [data-part="row2"] > span:last-child').first();
      // default: newest first → first card is job 0 (1000 QA)
      await expect(firstMeta).toContainText('1000 QA');
      await page.getByLabel('정렬').selectOption('total_qa');
      await expect(firstMeta).toContainText(`${1000 + 11 * 37} QA`); // descending
      await page.getByRole('button', { name: '내림차순' }).click();
      await expect(firstMeta).toContainText('1000 QA');
      await expect(page.getByText('1–5 / 12건')).toBeVisible();
      await page.locator('button:has(svg.lucide-chevron-right)').last().click();
      await expect(page.getByText('6–10 / 12건')).toBeVisible();
    });
  });
}

for (const width of [1024, 1440]) {
  test.describe(`dashboard desktop ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('model comparison folds after 4 on desktop too', async ({ page }) => {
      await openDashboard(page, 'dark', sixModelMetrics);
      await expect(page.locator('[data-role="bench-header"]')).toHaveCount(4);
      await page.getByRole('button', { name: '나머지 2개 모델 보기' }).click();
      await expect(page.locator('[data-role="bench-header"]')).toHaveCount(6);
    });

    test('keeps the 6-column table and model cells stay inside their column', async ({ page }) => {
      await openDashboard(page);
      const table = page.locator('table').first();
      await expect(table).toBeVisible();
      await expect(page.locator('[data-role="job-list"]')).toBeHidden();
      await expect(table.locator('thead th')).toHaveCount(6);
      const cells = await table.locator('tbody tr').first().locator('td').evaluateAll(tds =>
        tds.map(td => {
          const r = td.getBoundingClientRect();
          const inner = Array.from(td.querySelectorAll('*')).map(e => e.getBoundingClientRect());
          return inner.every(c => c.left >= r.left - 0.5 && c.right <= r.right + 0.5);
        })
      );
      expect(cells).toEqual(cells.map(() => true));
    });
  });
}
