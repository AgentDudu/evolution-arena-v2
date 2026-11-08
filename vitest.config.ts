import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Full arena runs are the point of these tests, so they need more than the 5s default. Hooks get
    // the same allowance because `behaviour.long.test.ts` builds its shared evolved world in a
    // beforeAll, which alone takes ~30 s. Neither raises the worker->host progress timeout, which is
    // fixed at 60 s in vitest 3.2: long loops must yield instead (see the long tests' chunk helpers).
    testTimeout: 180_000,
    hookTimeout: 180_000,
    include: ['test/**/*.test.ts'],
  },
});
