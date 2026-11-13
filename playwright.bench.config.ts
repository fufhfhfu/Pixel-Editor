import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/render-bench.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 300_000,
  expect: {
    timeout: 120_000,
  },
  use: {
    actionTimeout: 120_000,
    trace: 'off',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
