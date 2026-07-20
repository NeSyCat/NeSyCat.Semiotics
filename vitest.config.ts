import { defineConfig } from 'vitest/config'

// Headless domain-logic suites only (_tests/file/*.test.ts) — no DOM, no
// jsdom. Canvas.tsx and other client components can't be imported headless
// (see the comment in _tests/file/empty-form.test.ts); that's a documented
// gap, not something this config should paper over.
export default defineConfig({
  test: {
    include: ['_tests/**/*.test.ts'],
    environment: 'node',
  },
})
