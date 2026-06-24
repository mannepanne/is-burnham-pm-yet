// ABOUT: Vitest configuration for the worker + front-end test suite.
// ABOUT: Defaults to the node environment; DOM tests opt in via a docblock.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
    },
  },
});
