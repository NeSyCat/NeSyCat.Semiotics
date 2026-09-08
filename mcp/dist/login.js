#!/usr/bin/env node

// src/login.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";

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
function loginPort() {
  const raw = process.env.SEMIOTICS_LOGIN_PORT;
  const port = raw ? Number(raw) : 8976;
  return Number.isFinite(port) && port > 0 ? port : 8976;
}

// src/login.ts
var CALLBACK_HTML = (ok, detail) => `<!doctype html>
<html><body style="font-family: ui-sans-serif, system-ui; padding: 2rem;">
<h2>${ok ? "Signed in" : "Sign-in failed"}</h2>
<p>${detail}</p>
<p>You may close this tab and return to the terminal.</p>
</body></html>`;
function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", '""', url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
  }
}
async function main() {
  const client = getSupabaseClient();
  const port = loginPort();
  const redirectTo = `http://localhost:${port}/callback`;
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo, skipBrowserRedirect: true }
  });
  if (error || !data.url) {
    console.error("Failed to start sign-in:", error?.message ?? "no authorization URL returned");
    process.exitCode = 1;
    return;
  }
  const result = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      if (!code) {
        const message = oauthError ?? "No authorization code in the callback URL.";
        res.writeHead(400, { "Content-Type": "text/html" }).end(CALLBACK_HTML(false, message));
        server.close(() => resolve({ ok: false, message }));
        return;
      }
      client.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
        if (exchangeError) {
          res.writeHead(400, { "Content-Type": "text/html" }).end(CALLBACK_HTML(false, exchangeError.message));
          server.close(() => resolve({ ok: false, message: exchangeError.message }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" }).end(CALLBACK_HTML(true, "Session saved to mcp/.session.json."));
        server.close(() => resolve({ ok: true, message: "Session saved." }));
      }).catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        res.writeHead(500, { "Content-Type": "text/html" }).end(CALLBACK_HTML(false, message));
        server.close(() => resolve({ ok: false, message }));
      });
    });
    server.listen(port, () => {
      console.log(`Waiting for the GitHub sign-in to complete at http://localhost:${port}/callback ...`);
      console.log(`If the browser did not open automatically, visit:
${data.url}`);
      openBrowser(data.url);
    });
  });
  if (!result.ok) {
    console.error("Login failed:", result.message);
    process.exitCode = 1;
    return;
  }
  const { data: userData } = await client.auth.getUser();
  console.log(`Logged in as ${userData.user?.email ?? userData.user?.id ?? "(unknown user)"}.`);
}
await main();
