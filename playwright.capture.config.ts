import { defineConfig } from '@playwright/test';

// Real Electron origin/frame regression; no account server, database or physical screen capture.
export default defineConfig({
  testDir: './tests/ui', testMatch: 'desktop.spec.ts', grep: /native capture policy/,
  workers: 1, timeout: 45000, use: { headless: true },
});
