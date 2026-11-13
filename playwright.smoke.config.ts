import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/smoke.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 120_000,
  use: {
    trace: 'retain-on-failure',
  },
});
