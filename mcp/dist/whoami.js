#!/usr/bin/env node

// src/supabase/client.ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import { existsSync as existsSync2 } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/supabase/session-storage.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function readStore(path2) {
  if (!existsSync(path2)) return {};
  try {
    const raw = readFileSync(path2, "utf8");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeStore(path2, store) {
  mkdirSync(dirname(path2), { recursive: true });
  writeFileSync(path2, JSON.stringify(store, null, 2), "utf8");
}
function createFileStorage(path2) {
  return {
    async getItem(key) {
      return readStore(path2)[key] ?? null;
    },
    async setItem(key, value) {
      const store = readStore(path2);
      store[key] = value;
      writeStore(path2, store);
    },
    async removeItem(key) {
      const store = readStore(path2);
      if (!(key in store)) return;
      delete store[key];
      writeStore(path2, store);
    }
  };
}

// src/supabase/client.ts
function findPackageRoot(startDir) {
  let dir = startDir;
  for (; ; ) {
    if (existsSync2(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
var MCP_ROOT = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
var ENV_PATH = path.join(MCP_ROOT, ".env");
var SESSION_PATH = path.join(MCP_ROOT, ".session.json");
if (existsSync2(ENV_PATH)) loadDotenv({ path: ENV_PATH });
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set \u2014 copy mcp/.env.example to mcp/.env and fill it in (see mcp/README.md)`);
  }
  return value;
}
var cached;
function getSupabaseClient() {
  if (cached) return cached;
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  cached = createSupabaseClient(url, anonKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      storage: createFileStorage(SESSION_PATH)
    }
  });
  return cached;
}

// src/whoami.ts
async function main() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    console.log("Not logged in \u2014 run `npm run login`.");
    return;
  }
  console.log(`Logged in as ${data.user.email ?? "(no email)"} (id: ${data.user.id})`);
}
await main();
