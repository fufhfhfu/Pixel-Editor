import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  // В тестах компоненты Svelte нужны в браузерной сборке
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
