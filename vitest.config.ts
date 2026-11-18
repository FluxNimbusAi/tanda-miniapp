import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// P0.3 badge test lane (t_44ae186c). Default env is node so the seat-grants
// API route (node:sqlite) tests run for real; component files opt into jsdom
// with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
