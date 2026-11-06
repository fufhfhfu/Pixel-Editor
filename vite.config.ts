import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  // Svelte-компоненты в jsdom должны использовать DOM-совместимый runtime.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
