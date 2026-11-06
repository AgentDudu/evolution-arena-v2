import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Full arena runs are the point of these tests, so they need more than the 5s default.
    testTimeout: 180_000,
    include: ['test/**/*.test.ts'],
  },
});
