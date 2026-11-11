import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  // Electron loads the production bundle from file://, so asset URLs must
  // remain relative to dist/index.html instead of pointing at /assets/.
  base: './',
  // Svelte-компоненты в jsdom тестируются с клиентскими условиями сборки.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
