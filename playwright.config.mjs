import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: { browserName: 'chromium', headless: true, viewport: { width: 1500, height: 980 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list']],
});
