import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/desktop.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
