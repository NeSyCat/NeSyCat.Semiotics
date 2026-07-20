# _tests/file

Unit / file-level tests. Vitest is wired up (see `vitest.config.ts` at the repo
root) — run them with:

```
npm test          # run once
npm run test:watch  # watch mode
```

React Testing Library isn't in the dependency set yet — these suites are all
headless domain-logic tests (`environment: 'node'`, no jsdom); client
components like `Canvas.tsx` can't be imported headless (see the comment in
`empty-form.test.ts`).
