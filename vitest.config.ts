import { defineConfig } from 'vitest/config';

// convex-test needs the edge runtime to match how Convex executes functions.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'game', include: ['src/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'convex', include: ['convex/**/*.test.ts'], environment: 'edge-runtime' } },
    ],
  },
});
