import type { SeededUser } from './seed-users'

// Shape of .generated/stack.json — written by scripts/setup.ts, read by
// auth.setup.ts. Kept in its own module (not re-exported from scripts/
// setup.ts, which has a top-level `main().catch(...)` side effect) so
// importing the type never risks re-running the setup script.
export interface StackFile {
  apiUrl: string
  anonKey: string
  appOrigin: string
  primary: SeededUser
  invitee: SeededUser
}
