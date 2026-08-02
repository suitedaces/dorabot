import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'electron/**/*.{test,spec}.ts'],
    exclude: [
      '**/node_modules/**',
      // standalone tsx script that mirrors the layout logic instead of
      // importing it; not a vitest suite
      '**/useLayout.edgecases.test.ts',
    ],
  },
});
