import { defineConfig } from 'vitest/config'

// A local config, scoped to this package — without one, vitest walks up
// and picks up the app's own root vitest config (its `include` points at
// `_tests/**/*.test.ts`, which doesn't exist under mcp/, so it reports "no
// test files found"). `root` pins discovery to mcp/ itself.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test/**/*.test.ts'],
  },
})
