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
      // Enforce the project's coverage aims so they can't silently regress.
      // Scoped to src/** (the Worker); the front-end modules are guarded by the
      // happy-dom render tests rather than measured here.
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 95,
        branches: 90,
      },
    },
  },
});
