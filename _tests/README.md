# _tests/

Four test buckets, mirroring `01-Tech.00-*` from the project taxonomy:

| Folder | Tool | Scope |
|---|---|---|
| `manual/` | Chrome (you) | manual smoke checklists, exploratory testing |
| `file/` | Vitest + React Testing Library | unit / file-level |
| `e2e/` | Playwright | end-to-end flows in a real browser |
| `main/` | Playwright | smoke against production (nesycat.org) |

**Status:** `file/` is wired up — Vitest runs it via `npm test` (watch mode: `npm run test:watch`). `manual/`, `e2e/`, and `main/` are still scaffolds; Playwright will be wired up in a follow-up PR.
