import { defineConfig } from '@playwright/test';

// Runs against an already running app (Docker dev stack or `npm run dev`).
// Override the target with E2E_BASE_URL, e.g. a Vercel preview URL.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    colorScheme: 'dark',
  },
});
