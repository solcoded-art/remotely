import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5173', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node tests/ui/fixtures/account-server.cjs', url: 'http://127.0.0.1:3000/api/health', reuseExistingServer: false },
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
  ],
});
