import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Make `import 'cms-vercel'` resolve to source TS during tests so we
// don't need to rebuild dist/ before each `vitest run`.
export default defineConfig({
  resolve: {
    alias: {
      'cms-vercel': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
    },
  },
});
