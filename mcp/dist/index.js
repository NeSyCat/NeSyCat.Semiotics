#!/usr/bin/env node

// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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
function defaultOrgEnv() {
  const v = process.env.SEMIOTICS_DEFAULT_ORG;
  return v && v.trim() ? v.trim() : void 0;
}

// src/tools/result.ts
function text(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function errorText(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

// src/tools/whoami.ts
function registerWhoamiTools(server2, getClient2) {
  server2.registerTool(
    "whoami",
    {
      title: "Whoami",
      description: 'The currently signed-in user (email, id) \u2014 or a "not logged in" result if `npm run login` has not been run yet (see mcp/README.md).'
    },
    async () => {
      const { data, error } = await getClient2().auth.getUser();
      if (error || !data.user) {
        return text({ loggedIn: false, message: "Not logged in \u2014 run `npm run login` in mcp/." });
      }
      return text({ loggedIn: true, id: data.user.id, email: data.user.email ?? null });
    }
  );
}

// src/tools/organizations.ts
function registerOrganizationTools(server2, getClient2) {
  server2.registerTool(
    "list_organizations",
    {
      title: "List organizations",
      description: "Organizations the signed-in user belongs to (RLS-scoped \u2014 this can never see an organization the user is not a member of)."
    },
    async () => {
      const { data, error } = await getClient2().from("organizations").select("id, name").order("name");
      if (error) return errorText(error.message);
      return text(data);
    }
  );
}

// src/tools/diagrams.ts
import { z } from "zod";

// src/tools/org-resolve.ts
async function resolveOrganizationId(client, organizationId) {
  if (organizationId) {
    const { data: data2, error: error2 } = await client.from("organizations").select("id").eq("id", organizationId).maybeSingle();
    if (error2) return { error: error2.message };
    if (!data2) return { error: `No organization found with id ${organizationId} (or you are not a member of it)` };
    return { organizationId: data2.id };
  }
  const fallback = defaultOrgEnv();
  if (fallback) return { organizationId: fallback };
  const { data, error } = await client.from("organizations").select("id, name");
  if (error) return { error: error.message };
  const orgs = data ?? [];
  if (orgs.length === 1) return { organizationId: orgs[0].id };
  if (orgs.length === 0) {
    return { error: "You are not a member of any organization yet." };
  }
  return {
    error: "organizationId is required \u2014 you belong to multiple organizations. Call list_organizations, then pass one explicitly. Available: " + orgs.map((o) => `${o.name} (${o.id})`).join(", ")
  };
}

// ../components/editor/domain/position.ts
var Position = {
  Left: "left",
  Top: "top",
  Right: "right",
  Bottom: "bottom"
};

// ../components/editor/domain/forms.ts
var BASE_SIZE = 200;
var CORNER_R = 0.16;
var POINT_SIZE = 26;
function bodyCentroid(body) {
  if (body.type === "circle") return [0.5, 0.5];
  const pts = body.pointsFrac;
  let sx = 0, sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  return [sx / pts.length, sy / pts.length];
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function outwardEdgeNormal(a, b, centroid) {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len = Math.hypot(ex, ey) || 1;
  const nx = ey / len;
  const ny = -ex / len;
  const midx = (a[0] + b[0]) / 2;
  const midy = (a[1] + b[1]) / 2;
  const dot = (midx - centroid[0]) * nx + (midy - centroid[1]) * ny;
  return dot >= 0 ? { x: nx, y: ny } : { x: -nx, y: -ny };
}
function normalizeVec(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}
function rotateVec(v, deg) {
  if (!deg) return v;
  const th = deg * Math.PI / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}
function worldPointNormal(form, edgeKey, index, count) {
  const local = geometryFor(form.shape).pointNormal(edgeKey, index, count);
  if (!local) return null;
  return rotateVec(local, form.rotation ?? 0);
}
function screenCardinal(position, rotation) {
  const base = position === Position.Left ? [-1, 0] : position === Position.Right ? [1, 0] : position === Position.Top ? [0, -1] : [0, 1];
  const { x, y } = rotateVec({ x: base[0], y: base[1] }, rotation);
  return Math.abs(x) >= Math.abs(y) ? x >= 0 ? "right" : "left" : y >= 0 ? "bottom" : "top";
}
function pointIdsAt(form, edgeKey) {
  return form.edges[edgeKey] ?? [];
}
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function insetSegment(a, b, inset) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(inset, len / 2);
  const ux = dx / len, uy = dy / len;
  return [[a[0] + ux * t, a[1] + uy * t], [b[0] - ux * t, b[1] - uy * t]];
}
var SPOT_R = CORNER_R;
var SPOT_DISC_R = POINT_SIZE / BASE_SIZE / 2;
function spotAnchor(spot, n) {
  return { x: spot.at[0] * n, y: spot.at[1] * n, position: spot.position };
}
function spotNormal(spot, centroid) {
  return normalizeVec(spot.at[0] - centroid[0], spot.at[1] - centroid[1]);
}
function spotAt(spots, rx, ry, radius = SPOT_R) {
  let best;
  let bestD = Infinity;
  for (const key of Object.keys(spots)) {
    const [cx, cy] = spots[key].at;
    const d = Math.hypot(rx - cx, ry - cy);
    if (d <= radius && d < bestD) {
      bestD = d;
      best = key;
    }
  }
  return best;
}
function spotCapacities(keys) {
  return Object.fromEntries(keys.map((k) => [k, 1]));
}
var IDENTITY_SPOT = {
  center: { at: [0.5, 0.5], position: Position.Bottom }
};
var CENTER_SPOTS = {
  "center-up": { at: [0.5, 0.25], position: Position.Top },
  "center-down": { at: [0.5, 0.75], position: Position.Bottom },
  ...IDENTITY_SPOT
};
var CENTER_SPOT_KEYS = ["center-up", "center-down", "center"];
var TRI_R = 0.5;
var SQRT3_4 = Math.sqrt(3) / 4;
var TRI_APEX_X = 0.5 + TRI_R;
var TRI_APEX_Y = 0.5;
var TRI_BASE_X = 0.5 - TRI_R * Math.cos(Math.PI / 3);
var TRI_BASE_Y_TOP = 0.5 - SQRT3_4;
var TRI_BASE_Y_BOT = 0.5 + SQRT3_4;
var TRI_CENTROID = [
  (TRI_APEX_X + TRI_BASE_X + TRI_BASE_X) / 3,
  (TRI_APEX_Y + TRI_BASE_Y_TOP + TRI_BASE_Y_BOT) / 3
];
var TRI_EDGES = ["a", "b", "c", "peak", "corner-base-top", "corner-base-bottom", "center-up", "center"];
var TRI_CORNERS = {
  peak: { at: [TRI_APEX_X, TRI_APEX_Y], position: Position.Right },
  "corner-base-top": { at: [TRI_BASE_X, TRI_BASE_Y_TOP], position: Position.Top },
  "corner-base-bottom": { at: [TRI_BASE_X, TRI_BASE_Y_BOT], position: Position.Bottom }
};
var TRI_CENTER_UP = {
  // position Left — the label faces the CENTROID (the form's name), not the
  // apex: at the usual apex-up rotation that means BELOW the point, in the
  // open space between it and the name, instead of crowding the apex point's
  // own label above. (Purely the spot's declared label direction — hover/
  // click/drag/wire behavior all come from `at` and the shared machinery.)
  "center-up": { at: [0.75, 0.5], position: Position.Left }
};
var TRI_SPOTS = { ...TRI_CORNERS, ...TRI_CENTER_UP, ...IDENTITY_SPOT };
function triSlant(side, t, n) {
  const by = (side === "a" ? TRI_BASE_Y_TOP : TRI_BASE_Y_BOT) * n;
  const bx = TRI_BASE_X * n;
  return [bx + (TRI_APEX_X * n - bx) * t, by + (0.5 * n - by) * t];
}
var triangleGeometry = {
  shape: "triangle",
  displayName: "Triangle",
  edgeKeys: TRI_EDGES,
  body: { type: "polygon", pointsFrac: [[TRI_APEX_X, 0.5], [TRI_BASE_X, TRI_BASE_Y_BOT], [TRI_BASE_X, TRI_BASE_Y_TOP]] },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: () => BASE_SIZE,
  edgeCapacity: spotCapacities(Object.keys(TRI_SPOTS)),
  pointAnchor: (edgeKey, index, count, n) => {
    const spot = TRI_SPOTS[edgeKey];
    if (spot) return spotAnchor(spot, n);
    const t = (index + 1) / (count + 1);
    if (edgeKey === "a") {
      const [x, y] = triSlant("a", t, n);
      return { x, y, position: Position.Top };
    }
    if (edgeKey === "b") {
      const [x, y] = triSlant("b", t, n);
      return { x, y, position: Position.Bottom };
    }
    return { x: TRI_BASE_X * n, y: TRI_BASE_Y_TOP * n + t * (TRI_BASE_Y_BOT - TRI_BASE_Y_TOP) * n, position: Position.Left };
  },
  edgeAt: (rx, ry) => {
    const spot = spotAt(TRI_SPOTS, rx, ry, SPOT_DISC_R);
    if (spot) return spot;
    const da = distToSeg(rx, ry, TRI_BASE_X, TRI_BASE_Y_TOP, TRI_APEX_X, 0.5);
    const db = distToSeg(rx, ry, TRI_BASE_X, TRI_BASE_Y_BOT, TRI_APEX_X, 0.5);
    const dc = distToSeg(rx, ry, TRI_BASE_X, TRI_BASE_Y_TOP, TRI_BASE_X, TRI_BASE_Y_BOT);
    if (da <= db && da <= dc) return "a";
    if (db <= dc) return "b";
    return "c";
  },
  regionShape: (edgeKey) => {
    if (TRI_SPOTS[edgeKey]) return { kind: "spot", at: TRI_SPOTS[edgeKey].at };
    if (edgeKey === "a") return { kind: "polyline", points: insetSegment([TRI_BASE_X, TRI_BASE_Y_TOP], [TRI_APEX_X, 0.5], CORNER_R) };
    if (edgeKey === "b") return { kind: "polyline", points: insetSegment([TRI_BASE_X, TRI_BASE_Y_BOT], [TRI_APEX_X, 0.5], CORNER_R) };
    return { kind: "polyline", points: insetSegment([TRI_BASE_X, TRI_BASE_Y_TOP], [TRI_BASE_X, TRI_BASE_Y_BOT], CORNER_R) };
  },
  // Inverse of triSlant's t (y runs TRI_BASE_Y_TOP→0.5 for 'a',
  // TRI_BASE_Y_BOT→0.5 for 'b') / the direct linear t=(y-top)/(bot-top)
  // assignment for 'c' (see pointAnchor above). 'peak' has no ordering
  // (capacity 1, like 'empty's self) — the constant 0 is the trivial (and
  // only) valid inverse.
  edgeParam: (edgeKey, _rx, ry) => {
    if (TRI_SPOTS[edgeKey]) return 0;
    if (edgeKey === "a") return clamp01((ry - TRI_BASE_Y_TOP) / (0.5 - TRI_BASE_Y_TOP));
    if (edgeKey === "b") return clamp01((TRI_BASE_Y_BOT - ry) / (TRI_BASE_Y_BOT - 0.5));
    return clamp01((ry - TRI_BASE_Y_TOP) / (TRI_BASE_Y_BOT - TRI_BASE_Y_TOP));
  },
  // 'peak' (a vertex, not an edge): outward = radial, centroid through the
  // apex. 'a'/'b'/'c' (slant/base edges): the TRUE perpendicular of that
  // edge's own two vertices, picked outward via TRI_CENTROID — NOT the
  // coarse Position.Top/Bottom/Left pointAnchor above uses (those are label-
  // placement picks, arbitrary for a 60°/-60° slant). Constant per edgeKey
  // (a straight edge has one direction regardless of where along it a point
  // sits) — index/count unused, unlike circle's pointNormal below.
  pointNormal: (edgeKey) => {
    if (edgeKey === "center") return null;
    if (TRI_SPOTS[edgeKey]) return spotNormal(TRI_SPOTS[edgeKey], TRI_CENTROID);
    if (edgeKey === "a") return outwardEdgeNormal([TRI_BASE_X, TRI_BASE_Y_TOP], [TRI_APEX_X, 0.5], TRI_CENTROID);
    if (edgeKey === "b") return outwardEdgeNormal([TRI_BASE_X, TRI_BASE_Y_BOT], [TRI_APEX_X, 0.5], TRI_CENTROID);
    return outwardEdgeNormal([TRI_BASE_X, TRI_BASE_Y_TOP], [TRI_BASE_X, TRI_BASE_Y_BOT], TRI_CENTROID);
  }
};
var SQUARE_EDGES = ["top", "right", "bottom", "left", "corner-tl", "corner-tr", "corner-br", "corner-bl", "center-up", "center-down", "center"];
var SQUARE_CORNERS = {
  "corner-tl": { at: [0, 0], position: Position.Left },
  "corner-tr": { at: [1, 0], position: Position.Right },
  "corner-br": { at: [1, 1], position: Position.Right },
  "corner-bl": { at: [0, 1], position: Position.Left }
};
var SQUARE_SPOTS = { ...SQUARE_CORNERS, ...CENTER_SPOTS };
var squareGeometry = {
  shape: "square",
  displayName: "Square",
  edgeKeys: SQUARE_EDGES,
  body: { type: "polygon", pointsFrac: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: () => BASE_SIZE,
  edgeCapacity: spotCapacities([...Object.keys(SQUARE_CORNERS), ...CENTER_SPOT_KEYS]),
  pointAnchor: (edgeKey, index, count, n) => {
    const spot = SQUARE_SPOTS[edgeKey];
    if (spot) return spotAnchor(spot, n);
    const t = (index + 1) / (count + 1);
    switch (edgeKey) {
      case "top":
        return { x: t * n, y: 0, position: Position.Top };
      case "right":
        return { x: n, y: t * n, position: Position.Right };
      case "bottom":
        return { x: t * n, y: n, position: Position.Bottom };
      default:
        return { x: 0, y: t * n, position: Position.Left };
    }
  },
  edgeAt: (rx, ry) => {
    const spot = spotAt(SQUARE_SPOTS, rx, ry, SPOT_DISC_R);
    if (spot) return spot;
    const d = { top: ry, right: 1 - rx, bottom: 1 - ry, left: rx };
    return Object.keys(d).reduce((a, b) => d[b] < d[a] ? b : a);
  },
  regionShape: (edgeKey) => {
    const spot = SQUARE_SPOTS[edgeKey];
    if (spot) return { kind: "spot", at: spot.at };
    switch (edgeKey) {
      case "top":
        return { kind: "polyline", points: insetSegment([0, 0], [1, 0], CORNER_R) };
      case "right":
        return { kind: "polyline", points: insetSegment([1, 0], [1, 1], CORNER_R) };
      case "bottom":
        return { kind: "polyline", points: insetSegment([0, 1], [1, 1], CORNER_R) };
      default:
        return { kind: "polyline", points: insetSegment([0, 0], [0, 1], CORNER_R) };
    }
  },
  // Inverse of pointAnchor's t*n assignment: top/bottom run along x, left/
  // right run along y (see pointAnchor above).
  edgeParam: (edgeKey, rx, ry) => {
    if (SQUARE_SPOTS[edgeKey]) return 0;
    switch (edgeKey) {
      case "top":
      case "bottom":
        return clamp01(rx);
      default:
        return clamp01(ry);
    }
  },
  // Same 4 vertex pairs regionShape draws its hover stripes from (pre-inset
  // — inset doesn't change a segment's direction), outward via
  // outwardEdgeNormal — reduces to the plain axis-aligned unit vectors
  // (0,-1)/(1,0)/(0,1)/(-1,0) for an unrotated square, matching the old
  // static Position mapping exactly; worldPointNormal rotates it from there.
  // Spots (corners/centres) use their own radial normal from the body centre;
  // the dead-centre identity spot has no direction (null, a free end).
  pointNormal: (edgeKey) => {
    if (edgeKey === "center") return null;
    const spot = SQUARE_SPOTS[edgeKey];
    if (spot) return spotNormal(spot, [0.5, 0.5]);
    switch (edgeKey) {
      case "top":
        return outwardEdgeNormal([0, 0], [1, 0], [0.5, 0.5]);
      case "right":
        return outwardEdgeNormal([1, 0], [1, 1], [0.5, 0.5]);
      case "bottom":
        return outwardEdgeNormal([0, 1], [1, 1], [0.5, 0.5]);
      default:
        return outwardEdgeNormal([0, 0], [0, 1], [0.5, 0.5]);
    }
  }
};
var CIRCLE_EDGES = ["up", "right", "down", "left", "center-up", "center-down", "center"];
var ARC_START = {
  up: 3 * Math.PI / 4,
  right: Math.PI / 4,
  down: -Math.PI / 4,
  left: -(3 * Math.PI) / 4
};
var ARC_POSITION = { up: Position.Top, right: Position.Right, down: Position.Bottom, left: Position.Left };
function arcTheta(edgeKey, t) {
  return ARC_START[edgeKey] - t * (Math.PI / 2);
}
function arcPt(edgeKey, t, n) {
  const r = n / 2;
  const theta = arcTheta(edgeKey, t);
  return [n / 2 + r * Math.cos(theta), n / 2 - r * Math.sin(theta)];
}
function angleFromFraction(rx, ry) {
  return Math.atan2(-(ry - 0.5), rx - 0.5);
}
var ARC_REGION_SAMPLES = 10;
function arcRegionPoints(edgeKey) {
  return Array.from({ length: ARC_REGION_SAMPLES + 1 }, (_, i) => {
    const t = i / ARC_REGION_SAMPLES;
    const theta = ARC_START[edgeKey] - t * (Math.PI / 2);
    return [0.5 + 0.5 * Math.cos(theta), 0.5 - 0.5 * Math.sin(theta)];
  });
}
var circleGeometry = {
  shape: "circle",
  displayName: "Circle",
  edgeKeys: CIRCLE_EDGES,
  body: { type: "circle" },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: () => BASE_SIZE,
  edgeCapacity: spotCapacities(CENTER_SPOT_KEYS),
  pointAnchor: (edgeKey, index, count, n) => {
    const spot = CENTER_SPOTS[edgeKey];
    if (spot) return spotAnchor(spot, n);
    const t = (index + 1) / (count + 1);
    const [x, y] = arcPt(edgeKey, t, n);
    return { x, y, position: ARC_POSITION[edgeKey] };
  },
  edgeAt: (rx, ry) => {
    const spot = spotAt(CENTER_SPOTS, rx, ry, SPOT_DISC_R);
    if (spot) return spot;
    const ang = Math.atan2(-(ry - 0.5), rx - 0.5);
    if (ang > Math.PI / 4 && ang <= 3 * Math.PI / 4) return "up";
    if (ang > -Math.PI / 4 && ang <= Math.PI / 4) return "right";
    if (ang > -(3 * Math.PI) / 4 && ang <= -Math.PI / 4) return "down";
    return "left";
  },
  regionShape: (edgeKey) => {
    const spot = CENTER_SPOTS[edgeKey];
    if (spot) return { kind: "spot", at: spot.at };
    return { kind: "polyline", points: arcRegionPoints(edgeKey) };
  },
  // Inverse of arcPt's θ = ARC_START[edgeKey] − t·(π/2): recover θ, then
  // undo that subtraction — normalized into [0, 2π) first since 'left'
  // wraps across the ±π seam (ARC_START.left = −3π/4, so its far end lands
  // past π).
  edgeParam: (edgeKey, rx, ry) => {
    if (CENTER_SPOTS[edgeKey]) return 0;
    const theta = angleFromFraction(rx, ry);
    const raw = ARC_START[edgeKey] - theta;
    const norm = (raw % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return clamp01(norm / (Math.PI / 2));
  },
  // Radial — the SAME arcTheta formula arcPt itself uses, so a point's
  // outward normal always agrees with where arcPt actually placed it.
  // Unlike the other shapes, this genuinely varies by index/count (each
  // point along the arc faces its own direction, not one constant per edgeKey).
  pointNormal: (edgeKey, index, count) => {
    if (edgeKey === "center") return null;
    const spot = CENTER_SPOTS[edgeKey];
    if (spot) return spotNormal(spot, [0.5, 0.5]);
    const t = (index + 1) / (count + 1);
    const theta = arcTheta(edgeKey, t);
    return { x: Math.cos(theta), y: -Math.sin(theta) };
  }
};
var RHOMBUS_VERTS = { v0: [0.5, 0], v1: [1, 0.5], v2: [0.5, 1], v3: [0, 0.5] };
var RHOMBUS_EDGES = ["top-right", "bottom-right", "bottom-left", "top-left", "corner-top", "corner-right", "corner-bottom", "corner-left", "center-up", "center-down", "center"];
var RHOMBUS_CORNERS = {
  "corner-top": { at: RHOMBUS_VERTS.v0, position: Position.Top },
  "corner-right": { at: RHOMBUS_VERTS.v1, position: Position.Right },
  "corner-bottom": { at: RHOMBUS_VERTS.v2, position: Position.Bottom },
  "corner-left": { at: RHOMBUS_VERTS.v3, position: Position.Left }
};
var RHOMBUS_SPOTS = { ...RHOMBUS_CORNERS, ...CENTER_SPOTS };
var RHOMBUS_SIDES = {
  "top-right": { a: RHOMBUS_VERTS.v0, b: RHOMBUS_VERTS.v1, position: Position.Top },
  "bottom-right": { a: RHOMBUS_VERTS.v1, b: RHOMBUS_VERTS.v2, position: Position.Bottom },
  "bottom-left": { a: RHOMBUS_VERTS.v2, b: RHOMBUS_VERTS.v3, position: Position.Bottom },
  "top-left": { a: RHOMBUS_VERTS.v3, b: RHOMBUS_VERTS.v0, position: Position.Top }
};
var lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
var rhombusGeometry = {
  shape: "rhombus",
  displayName: "Rhombus",
  edgeKeys: RHOMBUS_EDGES,
  body: { type: "polygon", pointsFrac: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: () => BASE_SIZE,
  edgeCapacity: spotCapacities([...Object.keys(RHOMBUS_CORNERS), ...CENTER_SPOT_KEYS]),
  pointAnchor: (edgeKey, index, count, n) => {
    const spot = RHOMBUS_SPOTS[edgeKey];
    if (spot) return spotAnchor(spot, n);
    const side = RHOMBUS_SIDES[edgeKey];
    const t = (index + 1) / (count + 1);
    const [x, y] = lerp(side.a, side.b, t);
    return { x: x * n, y: y * n, position: side.position };
  },
  edgeAt: (rx, ry) => {
    const spot = spotAt(RHOMBUS_SPOTS, rx, ry, SPOT_DISC_R);
    if (spot) return spot;
    let best = "top-right";
    let bestDist = Infinity;
    for (const key of Object.keys(RHOMBUS_SIDES)) {
      const { a, b } = RHOMBUS_SIDES[key];
      const d = distToSeg(rx, ry, a[0], a[1], b[0], b[1]);
      if (d < bestDist) {
        bestDist = d;
        best = key;
      }
    }
    return best;
  },
  regionShape: (edgeKey) => {
    const spot = RHOMBUS_SPOTS[edgeKey];
    if (spot) return { kind: "spot", at: spot.at };
    const side = RHOMBUS_SIDES[edgeKey];
    return { kind: "polyline", points: insetSegment(side.a, side.b, CORNER_R) };
  },
  // Inverse of lerp(side.a, side.b, t): project (rx, ry) onto the side's own
  // segment (same a→b direction pointAnchor's lerp used) and clamp — the
  // general projection formula, since rhombus sides aren't axis-aligned.
  edgeParam: (edgeKey, rx, ry) => {
    const side = RHOMBUS_SIDES[edgeKey];
    if (!side) return 0;
    const { a, b } = side;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = ((rx - a[0]) * dx + (ry - a[1]) * dy) / len2;
    return clamp01(t);
  },
  // Same RHOMBUS_SIDES vertex pairs regionShape's hover stripe uses, outward
  // via outwardEdgeNormal — constant per edgeKey, like triangle/square (a
  // straight side has one direction). Spots (corners/centres) use their own
  // radial normal from the body centre; the dead-centre identity spot is null.
  pointNormal: (edgeKey) => {
    if (edgeKey === "center") return null;
    const spot = RHOMBUS_SPOTS[edgeKey];
    if (spot) return spotNormal(spot, [0.5, 0.5]);
    const side = RHOMBUS_SIDES[edgeKey];
    return outwardEdgeNormal(side.a, side.b, [0.5, 0.5]);
  }
};
var EMPTY_EDGE = "self";
var EMPTY_MAX_POINTS = 1;
var emptyGeometry = {
  shape: "empty",
  displayName: "Empty",
  edgeKeys: [EMPTY_EDGE],
  body: { type: "circle" },
  bodyOpacity: 0,
  showName: false,
  hasCenterZone: false,
  edgeCapacity: { [EMPTY_EDGE]: EMPTY_MAX_POINTS },
  pointIsForm: true,
  nodeSize: () => BASE_SIZE / 2,
  // Constant center, regardless of index/count — there's no fan to place:
  // the one middle point always sits at the form's own centre. Position
  // 'bottom' so its name (if any) renders centred BENEATH the dot, like an
  // ordinary point's outward label placement.
  pointAnchor: (_edgeKey, _index, _count, n) => ({ x: n / 2, y: n / 2, position: Position.Bottom }),
  edgeAt: () => EMPTY_EDGE,
  regionShape: () => ({ kind: "full" }),
  // No ordering exists — there's only ever one point — so the constant 0 is
  // the trivial (and only) valid inverse of pointAnchor's own constant.
  edgeParam: () => 0,
  // The one middle point IS the form (pointIsForm) — a free end, no
  // meaningful direction. worldPointNormal/wirePath read this null as "leave
  // straight toward the other endpoint" (bezier) / "no stub, turn exactly at
  // this point" (smoothstep).
  pointNormal: () => null
};
var formRegistry = {
  triangle: triangleGeometry,
  square: squareGeometry,
  circle: circleGeometry,
  rhombus: rhombusGeometry,
  empty: emptyGeometry
};
function geometryFor(shape) {
  return formRegistry[shape];
}
var SHAPES = Object.keys(formRegistry);

// ../components/editor/domain/wirepath.ts
var EDGE_STYLES = ["straight", "bezier", "smoothstep"];
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function fmt(n) {
  return (Math.round(n * 1e3) / 1e3).toString();
}
function vfmt(v) {
  return `${fmt(v.x)} ${fmt(v.y)}`;
}
var STRAIGHT_ANGLE_DEG = 10;
var STRAIGHT_MIN_PX = 1;
function isNearlyStraight(sx, sy, tx, ty) {
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);
  const mainDelta = Math.max(dx, dy);
  const crossDelta = Math.min(dx, dy);
  const threshold = Math.max(STRAIGHT_MIN_PX, Math.tan(STRAIGHT_ANGLE_DEG * Math.PI / 180) * mainDelta);
  return crossDelta <= threshold;
}
function straightPath(sx, sy, tx, ty) {
  return {
    d: `M ${vfmt({ x: sx, y: sy })} L ${vfmt({ x: tx, y: ty })}`,
    mid: { x: (sx + tx) / 2, y: (sy + ty) / 2 }
  };
}
var BEZIER_K_MIN = 24;
var BEZIER_K_MAX = 220;
function bezierPath(sx, sy, sDir, tx, ty, tDir) {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy) || 1;
  const k = clamp(0.5 * dist, BEZIER_K_MIN, BEZIER_K_MAX);
  const chordS = { x: dx / dist, y: dy / dist };
  const su = sDir ?? (tDir ? { x: -tDir.x, y: -tDir.y } : chordS);
  const tu = tDir ?? (sDir ? { x: -sDir.x, y: -sDir.y } : { x: -chordS.x, y: -chordS.y });
  const c1 = { x: sx + su.x * k, y: sy + su.y * k };
  const c2 = { x: tx + tu.x * k, y: ty + tu.y * k };
  const mid = {
    x: 0.125 * sx + 0.375 * c1.x + 0.375 * c2.x + 0.125 * tx,
    y: 0.125 * sy + 0.375 * c1.y + 0.375 * c2.y + 0.125 * ty
  };
  return { d: `M ${vfmt({ x: sx, y: sy })} C ${vfmt(c1)}, ${vfmt(c2)}, ${vfmt({ x: tx, y: ty })}`, c1, c2, mid };
}
var STEP_OFFSET = 24;
var STEP_RADIUS = 8;
function stepStubUnit(dir) {
  if (!dir) return null;
  return Math.abs(dir.x) >= Math.abs(dir.y) ? { x: dir.x >= 0 ? 1 : -1, y: 0 } : { x: 0, y: dir.y >= 0 ? 1 : -1 };
}
function elbowAxisHorizontal(sDir, sx, sy, tx, ty) {
  if (sDir) return Math.abs(sDir.x) >= Math.abs(sDir.y);
  return Math.abs(tx - sx) >= Math.abs(ty - sy);
}
function elbowCorners(s1, t1, horizontal, elbow) {
  if (elbow === "source") {
    return [s1, horizontal ? { x: s1.x, y: t1.y } : { x: t1.x, y: s1.y }];
  }
  if (horizontal) {
    const midX = (s1.x + t1.x) / 2;
    return [{ x: midX, y: s1.y }, { x: midX, y: t1.y }];
  }
  const midY = (s1.y + t1.y) / 2;
  return [{ x: s1.x, y: midY }, { x: t1.x, y: midY }];
}
function computeStepGeometry(sx, sy, sDir, tx, ty, tDir, elbow) {
  const horizontal = elbowAxisHorizontal(sDir, sx, sy, tx, ty);
  const axialRun = horizontal ? Math.abs(tx - sx) : Math.abs(ty - sy);
  const o = Math.min(STEP_OFFSET, axialRun / 3);
  const sv = stepStubUnit(sDir);
  const tv = stepStubUnit(tDir);
  const s1 = sv ? { x: sx + sv.x * o, y: sy + sv.y * o } : { x: sx, y: sy };
  const t1 = tv ? { x: tx + tv.x * o, y: ty + tv.y * o } : { x: tx, y: ty };
  const [rawCorner1, rawCorner2] = elbowCorners(s1, t1, horizontal, elbow);
  const clampToStubSpan = (c) => {
    const s1Main = horizontal ? s1.x : s1.y;
    const t1Main = horizontal ? t1.x : t1.y;
    const lo = Math.min(s1Main, t1Main);
    const hi = Math.max(s1Main, t1Main);
    return horizontal ? { x: clamp(c.x, lo, hi), y: c.y } : { x: c.x, y: clamp(c.y, lo, hi) };
  };
  return { sv, tv, s1, t1, corner1: clampToStubSpan(rawCorner1), corner2: clampToStubSpan(rawCorner2), horizontal };
}
function enforceMonotoneMainAxis(pts, horizontal) {
  const coord2 = (p) => horizontal ? p.x : p.y;
  const sign = Math.sign(coord2(pts[pts.length - 1]) - coord2(pts[0]));
  if (sign === 0) return pts;
  const out = [];
  let last = -Infinity;
  for (const p of pts) {
    const c = coord2(p) * sign;
    if (c >= last - 1e-6) {
      out.push(p);
      last = c;
    }
  }
  return out;
}
function smoothstepElbowPoints(sx, sy, sDir, tx, ty, tDir, elbow = "mid") {
  const { s1, t1, corner1, corner2, horizontal } = computeStepGeometry(sx, sy, sDir, tx, ty, tDir, elbow);
  const interior = enforceMonotoneMainAxis([s1, corner1, corner2, t1], horizontal);
  const raw = [{ x: sx, y: sy }, ...interior, { x: tx, y: ty }];
  const pts = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) pts.push(p);
  }
  return pts;
}
function smoothstepMid(sx, sy, sDir, tx, ty, tDir, elbow) {
  const { corner1, corner2 } = computeStepGeometry(sx, sy, sDir, tx, ty, tDir, elbow);
  return { x: (corner1.x + corner2.x) / 2, y: (corner1.y + corner2.y) / 2 };
}
var MIN_ARC_RADIUS = 0.75;
var NEAR_COLLINEAR_DEG = 3;
function roundedPolylinePath(pts) {
  if (pts.length < 2) return pts.length === 1 ? `M ${vfmt(pts[0])}` : "";
  if (pts.length === 2) return `M ${vfmt(pts[0])} L ${vfmt(pts[1])}`;
  let d = `M ${vfmt(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const corner = pts[i];
    const next = pts[i + 1];
    const segIn = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const segOut = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(STEP_RADIUS, segIn / 2, segOut / 2);
    if (r < MIN_ARC_RADIUS) {
      d += ` L ${vfmt(corner)}`;
      continue;
    }
    const inX = (corner.x - prev.x) / segIn;
    const inY = (corner.y - prev.y) / segIn;
    const outX = (next.x - corner.x) / segOut;
    const outY = (next.y - corner.y) / segOut;
    const dot = Math.max(-1, Math.min(1, inX * outX + inY * outY));
    const turnDeg = Math.acos(dot) * 180 / Math.PI;
    if (turnDeg < NEAR_COLLINEAR_DEG || turnDeg > 180 - NEAR_COLLINEAR_DEG) {
      d += ` L ${vfmt(corner)}`;
      continue;
    }
    const a = { x: corner.x - inX * r, y: corner.y - inY * r };
    const b = { x: corner.x + outX * r, y: corner.y + outY * r };
    const cross = inX * outY - inY * outX;
    const sweep = cross > 0 ? 1 : 0;
    d += ` L ${vfmt(a)} A ${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${vfmt(b)}`;
  }
  d += ` L ${vfmt(pts[pts.length - 1])}`;
  return d;
}
function smoothstepPath(sx, sy, sDir, tx, ty, tDir, elbow) {
  const pts = smoothstepElbowPoints(sx, sy, sDir, tx, ty, tDir, elbow);
  return { d: roundedPolylinePath(pts), mid: smoothstepMid(sx, sy, sDir, tx, ty, tDir, elbow) };
}
function wirePath(sx, sy, sDir, tx, ty, tDir, style, elbow = "mid") {
  if (style === "straight") return straightPath(sx, sy, tx, ty);
  if (isNearlyStraight(sx, sy, tx, ty)) return straightPath(sx, sy, tx, ty);
  if (style === "bezier") return bezierPath(sx, sy, sDir, tx, ty, tDir);
  return smoothstepPath(sx, sy, sDir, tx, ty, tDir, elbow);
}

// ../components/editor/domain/ids.ts
function nextNumberedId(taken, prefix) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const id of taken) {
    const m = id.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}${max + 1}`;
}
function newFormId(d) {
  return nextNumberedId(d.forms.map((f) => f.id), "F");
}
function newPointId(d) {
  return nextNumberedId(Object.keys(d.points), "P");
}
function newLineId(d) {
  return nextNumberedId(d.lines.map((l) => l.id), "L");
}

// ../components/editor/domain/mutations.ts
function emptySlots(shape) {
  const geom = geometryFor(shape);
  const edges = {};
  for (const k of geom.edgeKeys) edges[k] = [];
  return { edges };
}
function allFormPointIds(form) {
  const ids = /* @__PURE__ */ new Set();
  for (const k of Object.keys(form.edges)) for (const pid of form.edges[k]) ids.add(pid);
  return ids;
}
function addForm(d, shape, position, color) {
  const id = newFormId(d);
  const form = { id, shape, position, ...color ? { color } : {}, ...emptySlots(shape) };
  const withForm = { ...d, forms: [...d.forms, form] };
  const geom = geometryFor(shape);
  if (geom.pointIsForm) {
    const edgeKey = geom.edgeKeys[0];
    if (edgeKey !== void 0) {
      const [seeded] = addPoint(withForm, id, edgeKey);
      return [seeded, id];
    }
  }
  return [withForm, id];
}
function deleteForm(d, id) {
  const form = d.forms.find((f) => f.id === id);
  if (!form) return d;
  const ptIds = allFormPointIds(form);
  const points = { ...d.points };
  for (const pid of ptIds) delete points[pid];
  const lines = pruneLines(d.lines, ptIds);
  return { ...d, forms: d.forms.filter((f) => f.id !== id), points, lines };
}
function moveForm(d, id, position) {
  return { ...d, forms: d.forms.map((f) => f.id === id ? { ...f, position } : f) };
}
function renameForm(d, id, name) {
  return { ...d, forms: d.forms.map((f) => f.id === id ? { ...f, name } : f) };
}
function addPoint(d, formId, edgeKey, shape = "empty", index) {
  const form = d.forms.find((f) => f.id === formId);
  if (!form) return [d, ""];
  const geom = geometryFor(form.shape);
  const capacity = geom.edgeCapacity?.[edgeKey];
  if (capacity !== void 0) {
    const list2 = form.edges[edgeKey] ?? [];
    if (list2.length >= capacity) return [d, list2[0]];
  }
  const id = newPointId(d);
  const point = { id, shape, formId, edgeKey };
  const list = form.edges[edgeKey] ?? [];
  const at = index === void 0 ? list.length : Math.max(0, Math.min(index, list.length));
  const updated = { ...form, edges: { ...form.edges, [edgeKey]: [...list.slice(0, at), id, ...list.slice(at)] } };
  const forms = d.forms.map((f) => f.id === formId ? updated : f);
  return [{ ...d, forms, points: { ...d.points, [id]: point } }, id];
}
function removePoint(d, pointId) {
  const pt = d.points[pointId];
  if (!pt) return d;
  const owner = d.forms.find((f) => f.id === pt.formId);
  if (owner && geometryFor(owner.shape).pointIsForm) {
    return deleteForm(d, owner.id);
  }
  const forms = d.forms.map(
    (f) => f.id !== pt.formId ? f : { ...f, edges: { ...f.edges, [pt.edgeKey]: (f.edges[pt.edgeKey] ?? []).filter((id) => id !== pointId) } }
  );
  const points = { ...d.points };
  delete points[pointId];
  return { ...d, forms, points, lines: pruneLines(d.lines, /* @__PURE__ */ new Set([pointId])) };
}
function renamePoint(d, id, name) {
  const pt = d.points[id];
  if (!pt) return d;
  return { ...d, points: { ...d.points, [id]: { ...pt, name } } };
}
function addLine(d, sourcePtId, targetPtId) {
  const id = newLineId(d);
  const line = { id, source: sourcePtId, targets: [targetPtId] };
  return [{ ...d, lines: [...d.lines, line] }, id];
}
function addLineTarget(d, lineId, targetPtId) {
  return {
    ...d,
    lines: d.lines.map(
      (l) => l.id === lineId && !l.targets.includes(targetPtId) ? { ...l, targets: [...l.targets, targetPtId] } : l
    )
  };
}
function deleteLine(d, lineId) {
  return { ...d, lines: d.lines.filter((l) => l.id !== lineId) };
}
function renameLine(d, id, name) {
  const set = /* @__PURE__ */ new Set([id]);
  return { ...d, lines: d.lines.map((l) => set.has(l.id) ? { ...l, name } : l) };
}
function pruneLines(lines, removed) {
  return lines.map((l) => ({ ...l, targets: l.targets.filter((t) => !removed.has(t)) })).filter((l) => !removed.has(l.source) && l.targets.length > 0);
}

// ../components/editor/persist/io.ts
var FALLBACK_COLOR = [52 / 255, 120 / 255, 246 / 255];
var VALID_SHAPES = new Set(SHAPES);
var VALID_NON_DEFAULT_EDGE_STYLES = new Set(EDGE_STYLES.filter((s) => s !== "straight"));
function canonEdgeStyle(raw) {
  return typeof raw === "string" && VALID_NON_DEFAULT_EDGE_STYLES.has(raw) ? raw : void 0;
}
function asColor(c) {
  if (Array.isArray(c) && c.length === 3) return [Number(c[0]), Number(c[1]), Number(c[2])];
  return [...FALLBACK_COLOR];
}
function canonForm(f) {
  const pos = f.position ?? {};
  const shape = f.shape ?? f.kind;
  const geom = geometryFor(shape);
  const rawEdges = f.edges ?? {};
  const edges = {};
  for (const k of geom.edgeKeys) {
    edges[k] = Array.isArray(rawEdges[k]) ? rawEdges[k] : [];
  }
  return {
    id: String(f.id),
    shape,
    ...f.name !== void 0 ? { name: String(f.name) } : {},
    ...f.color != null ? { color: asColor(f.color) } : {},
    ...f.rotation != null ? { rotation: Number(f.rotation) } : {},
    ...f.scale != null && Number.isFinite(Number(f.scale)) && Number(f.scale) > 0 ? { scale: Math.max(0.25, Math.min(4, Number(f.scale))) } : {},
    position: { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0) },
    edges
  };
}
function canonPoint(p) {
  const shape = typeof p.shape === "string" && VALID_SHAPES.has(p.shape) ? p.shape : "empty";
  return {
    id: String(p.id),
    shape,
    ...p.name !== void 0 ? { name: String(p.name) } : {},
    ...p.color != null ? { color: asColor(p.color) } : {},
    formId: String(p.formId),
    edgeKey: String(p.edgeKey)
  };
}
function canonLine(l) {
  return {
    id: String(l.id),
    ...l.name !== void 0 ? { name: String(l.name) } : {},
    ...l.color != null ? { color: asColor(l.color) } : {},
    source: String(l.source),
    targets: Array.isArray(l.targets) ? l.targets.map(String) : []
  };
}
var CORNER_KEY_RE = /^v\d+$/;
function dropRemovedShapes(rawForms, rawPoints) {
  const removedPointIds = /* @__PURE__ */ new Set();
  const collectOwnedPointIds = (f) => {
    const edges = f.edges ?? {};
    for (const k of Object.keys(edges)) for (const pid of edges[k] ?? []) removedPointIds.add(String(pid));
    const corners = f.corners ?? {};
    for (const k of Object.keys(corners)) {
      const pid = corners[k];
      if (pid) removedPointIds.add(String(pid));
    }
  };
  const survivingForms = [];
  for (const f of rawForms) {
    if (f.shape === "point" || f.kind === "point") {
      collectOwnedPointIds(f);
      continue;
    }
    const corners = f.corners ?? {};
    for (const k of Object.keys(corners)) {
      const pid = corners[k];
      if (pid) removedPointIds.add(String(pid));
    }
    survivingForms.push(f);
  }
  for (const k of Object.keys(rawPoints)) {
    const p = rawPoints[k] ?? {};
    if (typeof p.edgeKey === "string" && CORNER_KEY_RE.test(p.edgeKey)) removedPointIds.add(k);
  }
  const survivingPoints = {};
  for (const k of Object.keys(rawPoints)) {
    if (!removedPointIds.has(k)) survivingPoints[k] = rawPoints[k];
  }
  return { forms: survivingForms, points: survivingPoints, removedPointIds };
}
function collapseEmptyForms(forms, points, lines) {
  const remap = /* @__PURE__ */ new Map();
  let droppedForm = false;
  const nextForms = [];
  for (const f of forms) {
    if (f.shape !== "empty") {
      nextForms.push(f);
      continue;
    }
    const edgeKey = geometryFor(f.shape).edgeKeys[0];
    const ids = f.edges[edgeKey] ?? [];
    if (ids.length === 0) {
      droppedForm = true;
      continue;
    }
    if (ids.length === 1) {
      nextForms.push(f);
      continue;
    }
    const [keep, ...drop] = ids;
    for (const id of drop) remap.set(id, keep);
    nextForms.push({ ...f, edges: { ...f.edges, [edgeKey]: [keep] } });
  }
  if (remap.size === 0 && !droppedForm) return { forms, points, lines };
  if (remap.size === 0) return { forms: nextForms, points, lines };
  const nextPoints = { ...points };
  for (const id of remap.keys()) delete nextPoints[id];
  const rewrite = (id) => remap.get(id) ?? id;
  const touchesRemap = (l) => remap.has(l.source) || l.targets.some((t) => remap.has(t));
  const nextLines = [];
  for (const l of lines) {
    if (!touchesRemap(l)) {
      nextLines.push(l);
      continue;
    }
    const source = rewrite(l.source);
    const targets = [...new Set(l.targets.map(rewrite))].filter((t) => t !== source);
    if (targets.length === 0) continue;
    nextLines.push({ ...l, source, targets });
  }
  return { forms: nextForms, points: nextPoints, lines: nextLines };
}
function parseIfString(raw) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function restoreDiagram(raw) {
  const src = parseIfString(raw);
  const d = typeof src === "object" && src !== null ? src : {};
  const rawForms = Array.isArray(d.forms) ? d.forms : [];
  const rawPoints = d.points && typeof d.points === "object" ? d.points : {};
  const dropped = dropRemovedShapes(rawForms, rawPoints);
  const forms = dropped.forms.map((f) => canonForm(f));
  const points = {};
  for (const k of Object.keys(dropped.points)) points[k] = canonPoint(dropped.points[k]);
  const rawLines = Array.isArray(d.lines) ? d.lines.map((l) => canonLine(l)) : [];
  const lines = pruneLines(rawLines, dropped.removedPointIds);
  const collapsed = collapseEmptyForms(forms, points, lines);
  const edgeStyle = canonEdgeStyle(d.edgeStyle);
  return {
    schemaVersion: typeof d.schemaVersion === "number" ? d.schemaVersion : 1,
    forms: collapsed.forms,
    points: collapsed.points,
    lines: collapsed.lines,
    ...edgeStyle !== void 0 ? { edgeStyle } : {}
  };
}

// src/diagram/defaults.ts
function emptyDiagram() {
  return { schemaVersion: 1, forms: [], points: {}, lines: [] };
}

// src/diagram/ops.ts
function validated(d, id) {
  return { ok: true, diagram: restoreDiagram(d), id };
}
function addFormOp(d, args) {
  if (!SHAPES.includes(args.shape)) {
    return { ok: false, error: `Invalid shape "${args.shape}" \u2014 valid shapes: ${SHAPES.join(", ")}` };
  }
  let [next, id] = addForm(d, args.shape, args.position ?? { x: 0, y: 0 }, args.color ?? null);
  if (args.name) next = renameForm(next, id, args.name);
  return validated(next, id);
}
function addPointOp(d, args) {
  const form = d.forms.find((f) => f.id === args.formId);
  if (!form) return { ok: false, error: `No form found with id ${args.formId}` };
  const validKeys = geometryFor(form.shape).edgeKeys;
  if (!validKeys.includes(args.edgeKey)) {
    return {
      ok: false,
      error: `"${args.edgeKey}" is not a valid edge key for a ${form.shape} \u2014 valid keys: ${validKeys.join(", ")}`
    };
  }
  let [next, id] = addPoint(d, args.formId, args.edgeKey, args.shape ?? "empty");
  if (args.name) next = renamePoint(next, id, args.name);
  return validated(next, id);
}
function addLineOp(d, args) {
  if (!d.points[args.sourcePointId]) return { ok: false, error: `No point found with id ${args.sourcePointId}` };
  if (args.targetPointIds.length === 0) return { ok: false, error: "targetPointIds must have at least one point id" };
  for (const t of args.targetPointIds) {
    if (!d.points[t]) return { ok: false, error: `No point found with id ${t} (targetPointIds)` };
  }
  const [first, ...rest] = args.targetPointIds;
  let [next, id] = addLine(d, args.sourcePointId, first);
  for (const t of rest) next = addLineTarget(next, id, t);
  if (args.name) next = renameLine(next, id, args.name);
  return validated(next, id);
}
function removeElementOp(d, kind, id) {
  switch (kind) {
    case "form":
      if (!d.forms.some((f) => f.id === id)) return { ok: false, error: `No form found with id ${id}` };
      return validated(deleteForm(d, id));
    case "point":
      if (!d.points[id]) return { ok: false, error: `No point found with id ${id}` };
      return validated(removePoint(d, id));
    case "line":
      if (!d.lines.some((l) => l.id === id)) return { ok: false, error: `No line found with id ${id}` };
      return validated(deleteLine(d, id));
  }
}
function setElementNameOp(d, kind, id, name) {
  switch (kind) {
    case "form":
      if (!d.forms.some((f) => f.id === id)) return { ok: false, error: `No form found with id ${id}` };
      return validated(renameForm(d, id, name));
    case "point":
      if (!d.points[id]) return { ok: false, error: `No point found with id ${id}` };
      return validated(renamePoint(d, id, name));
    case "line":
      if (!d.lines.some((l) => l.id === id)) return { ok: false, error: `No line found with id ${id}` };
      return validated(renameLine(d, id, name));
  }
}
function moveFormOp(d, formId, position) {
  if (!d.forms.some((f) => f.id === formId)) return { ok: false, error: `No form found with id ${formId}` };
  return validated(moveForm(d, formId, position));
}
function validateDiagram(raw) {
  const diagram = restoreDiagram(raw);
  const problems = [];
  const formIds = new Set(diagram.forms.map((f) => f.id));
  const pointIds = new Set(Object.keys(diagram.points));
  for (const [pid, pt] of Object.entries(diagram.points)) {
    if (!formIds.has(pt.formId)) problems.push(`point ${pid} references missing form ${pt.formId}`);
  }
  for (const form of diagram.forms) {
    for (const [edgeKey, ids] of Object.entries(form.edges)) {
      for (const pid of ids) {
        if (!pointIds.has(pid)) problems.push(`form ${form.id} edge ${edgeKey} references missing point ${pid}`);
      }
    }
  }
  for (const line of diagram.lines) {
    if (!pointIds.has(line.source)) problems.push(`line ${line.id} references missing source point ${line.source}`);
    for (const t of line.targets) {
      if (!pointIds.has(t)) problems.push(`line ${line.id} references missing target point ${t}`);
    }
  }
  return { ok: problems.length === 0, problems, diagram };
}
function duplicateData(data) {
  return JSON.parse(JSON.stringify(data));
}
function duplicateTitle(originalTitle, explicitTitle) {
  return explicitTitle ?? `${originalTitle} (copy)`;
}

// src/tools/diagrams.ts
var dataSchema = z.unknown().describe("The diagram document (Diagram JSON: schemaVersion/forms/points/lines).");
function registerDiagramTools(server2, getClient2) {
  server2.registerTool(
    "list_diagrams",
    {
      title: "List diagrams",
      description: "List diagrams (id, title, organization, last updated) \u2014 RLS-scoped to the organizations the signed-in user belongs to. Pass organizationId to narrow to one.",
      inputSchema: { organizationId: z.string().uuid().optional() }
    },
    async ({ organizationId }) => {
      let query = getClient2().from("diagrams").select("id, title, organization_id, updated_at").order("updated_at", { ascending: false });
      if (organizationId) query = query.eq("organization_id", organizationId);
      const { data, error } = await query;
      if (error) return errorText(error.message);
      return text(data);
    }
  );
  server2.registerTool(
    "get_diagram",
    {
      title: "Get diagram",
      description: "Fetch one diagram in full, including its data (forms/points/lines).",
      inputSchema: { id: z.string().uuid() }
    },
    async ({ id }) => {
      const { data, error } = await getClient2().from("diagrams").select("*").eq("id", id).maybeSingle();
      if (error) return errorText(error.message);
      if (!data) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`);
      return text(data);
    }
  );
  server2.registerTool(
    "create_diagram",
    {
      title: "Create diagram",
      description: "Create a new diagram. organizationId is optional \u2014 falls back to SEMIOTICS_DEFAULT_ORG, then to the user's only organization if unambiguous; otherwise call list_organizations and pass one explicitly. `data` defaults to an empty diagram.",
      inputSchema: { title: z.string().min(1), organizationId: z.string().uuid().optional(), data: dataSchema.optional() }
    },
    async ({ title, organizationId, data }) => {
      const validated2 = validateDiagram(data ?? emptyDiagram());
      if (!validated2.ok) return errorText(`Diagram has dangling references, refusing to save:
${validated2.problems.join("\n")}`);
      const diagramData = validated2.diagram;
      const client = getClient2();
      const resolved = await resolveOrganizationId(client, organizationId);
      if ("error" in resolved) return errorText(resolved.error);
      const { data: row, error } = await client.from("diagrams").insert({ title, organization_id: resolved.organizationId, data: diagramData }).select("*").single();
      if (error) return errorText(error.message);
      return text(row);
    }
  );
  server2.registerTool(
    "update_diagram",
    {
      title: "Update diagram",
      description: "Full replace of a diagram's data, after normalization and referential validation (rejects dangling point/form/line references).",
      inputSchema: { id: z.string().uuid(), data: dataSchema }
    },
    async ({ id, data }) => {
      const validated2 = validateDiagram(data);
      if (!validated2.ok) return errorText(`Diagram has dangling references, refusing to save:
${validated2.problems.join("\n")}`);
      const diagramData = validated2.diagram;
      const { data: row, error } = await getClient2().from("diagrams").update({ data: diagramData, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id).select("*").maybeSingle();
      if (error) return errorText(error.message);
      if (!row) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`);
      return text(row);
    }
  );
  server2.registerTool(
    "rename_diagram",
    {
      title: "Rename diagram",
      description: "Change a diagram's title only.",
      inputSchema: { id: z.string().uuid(), title: z.string().min(1) }
    },
    async ({ id, title }) => {
      const { data: row, error } = await getClient2().from("diagrams").update({ title, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id).select("*").maybeSingle();
      if (error) return errorText(error.message);
      if (!row) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`);
      return text(row);
    }
  );
  server2.registerTool(
    "delete_diagram",
    {
      title: "Delete diagram",
      description: "Permanently delete a diagram. Requires confirm:true \u2014 refuses otherwise.",
      inputSchema: { id: z.string().uuid(), confirm: z.boolean() }
    },
    async ({ id, confirm }) => {
      if (!confirm) return errorText("Refusing to delete without confirm:true.");
      const { data: row, error } = await getClient2().from("diagrams").delete().eq("id", id).select("id").maybeSingle();
      if (error) return errorText(error.message);
      if (!row) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`);
      return text({ deleted: true, id });
    }
  );
  server2.registerTool(
    "duplicate_diagram",
    {
      title: "Duplicate diagram",
      description: 'Copy a diagram (its data, unchanged) into a new row in the same organization. Title defaults to "<title> (copy)".',
      inputSchema: { id: z.string().uuid(), title: z.string().min(1).optional() }
    },
    async ({ id, title }) => {
      const client = getClient2();
      const { data: original, error: getError } = await client.from("diagrams").select("*").eq("id", id).maybeSingle();
      if (getError) return errorText(getError.message);
      if (!original) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`);
      const copiedData = duplicateData(restoreDiagram(original.data));
      const { data: row, error } = await client.from("diagrams").insert({
        title: duplicateTitle(original.title, title),
        organization_id: original.organization_id,
        data: copiedData
      }).select("*").single();
      if (error) return errorText(error.message);
      return text(row);
    }
  );
}

// src/tools/drawing.ts
import { z as z2 } from "zod";
var ShapeEnum = z2.enum(SHAPES);
var ColorSchema = z2.tuple([z2.number().min(0).max(1), z2.number().min(0).max(1), z2.number().min(0).max(1)]);
var PositionSchema = z2.object({ x: z2.number(), y: z2.number() });
var KindEnum = z2.enum(["form", "point", "line"]);
async function withDiagram(client, diagramId, op) {
  const { data: row, error: getError } = await client.from("diagrams").select("*").eq("id", diagramId).maybeSingle();
  if (getError) return errorText(getError.message);
  if (!row) return errorText(`No diagram found with id ${diagramId} (or you are not a member of its organization)`);
  const current = restoreDiagram(row.data);
  const result = op(current);
  if (!result.ok) return errorText(result.error);
  const { data: updated, error: updateError } = await client.from("diagrams").update({ data: result.diagram, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", diagramId).select("*").maybeSingle();
  if (updateError) return errorText(updateError.message);
  if (!updated) return errorText(`Diagram ${diagramId} disappeared during update.`);
  return text(result.id ? { ...updated, newId: result.id } : updated);
}
function registerDrawingTools(server2, getClient2) {
  server2.registerTool(
    "add_form",
    {
      title: "Add form",
      description: 'Add a new form (a "big shape": triangle/square/circle/rhombus/empty) to a diagram.',
      inputSchema: {
        diagramId: z2.string().uuid(),
        shape: ShapeEnum,
        position: PositionSchema.optional().describe("Defaults to {x:0,y:0}."),
        name: z2.string().optional(),
        color: ColorSchema.optional().describe("[r,g,b], each 0..1.")
      }
    },
    async ({ diagramId, shape, position, name, color }) => withDiagram(getClient2(), diagramId, (d) => addFormOp(d, { shape, position, name, color }))
  );
  server2.registerTool(
    "add_point",
    {
      title: "Add point",
      description: "Add a point on one of a form's edges, corners, or centre spots. The edgeKey must be valid for that form's shape \u2014 sides plus vertex/centre spots: square top/right/bottom/left + corners corner-tl/corner-tr/corner-br/corner-bl + centres center-up/center-down; rhombus top-right/bottom-right/bottom-left/top-left + corners corner-top/corner-right/corner-bottom/corner-left + center-up/center-down; triangle a/b/c + apex peak + base corners corner-base-top/corner-base-bottom; circle up/right/down/left + center-up/center-down; empty self. Corner and centre spots hold at most one point each. An invalid edgeKey is rejected with the valid list for that shape.",
      inputSchema: {
        diagramId: z2.string().uuid(),
        formId: z2.string(),
        edgeKey: z2.string(),
        name: z2.string().optional(),
        shape: ShapeEnum.optional().describe("The point's own small glyph shape; defaults to 'empty' (no glyph).")
      }
    },
    async ({ diagramId, formId, edgeKey, name, shape }) => withDiagram(getClient2(), diagramId, (d) => addPointOp(d, { formId, edgeKey, name, shape }))
  );
  server2.registerTool(
    "add_line",
    {
      title: "Add line",
      description: "Add a line (a hyperedge: one source point, one or more target points) between existing points.",
      inputSchema: {
        diagramId: z2.string().uuid(),
        sourcePointId: z2.string(),
        targetPointIds: z2.array(z2.string()).min(1),
        name: z2.string().optional()
      }
    },
    async ({ diagramId, sourcePointId, targetPointIds, name }) => withDiagram(getClient2(), diagramId, (d) => addLineOp(d, { sourcePointId, targetPointIds, name }))
  );
  server2.registerTool(
    "remove_element",
    {
      title: "Remove element",
      description: "Remove a form, point, or line by id. Removing a form also removes its points and any lines that touched them; removing a point does the same for lines touching just it.",
      inputSchema: { diagramId: z2.string().uuid(), kind: KindEnum, id: z2.string() }
    },
    async ({ diagramId, kind, id }) => withDiagram(getClient2(), diagramId, (d) => removeElementOp(d, kind, id))
  );
  server2.registerTool(
    "set_element_name",
    {
      title: "Set element name",
      description: "Rename a form, point, or line. An empty string clears the name back to the default (id fallback).",
      inputSchema: { diagramId: z2.string().uuid(), kind: KindEnum, id: z2.string(), name: z2.string() }
    },
    async ({ diagramId, kind, id, name }) => withDiagram(getClient2(), diagramId, (d) => setElementNameOp(d, kind, id, name))
  );
  server2.registerTool(
    "move_form",
    {
      title: "Move form",
      description: "Move a form to a new canvas position (its own x/y \u2014 doesn't affect its points/lines' logical structure).",
      inputSchema: { diagramId: z2.string().uuid(), formId: z2.string(), position: PositionSchema }
    },
    async ({ diagramId, formId, position }) => withDiagram(getClient2(), diagramId, (d) => moveFormOp(d, formId, position))
  );
}

// src/tools/validate.ts
import { z as z3 } from "zod";
function registerValidateTools(server2) {
  server2.registerTool(
    "validate_diagram",
    {
      title: "Validate diagram",
      description: "Normalize+validate a diagram document (restoreDiagram) and report any dangling references it still has (a point naming a form that doesn't exist, a line or form edge naming a point that doesn't exist). Does not write anything.",
      inputSchema: { data: z3.unknown() }
    },
    async ({ data }) => {
      const result = validateDiagram(data);
      return text({ ok: result.ok, problems: result.problems });
    }
  );
}

// src/tools/import_export.ts
import { z as z4 } from "zod";

// ../components/editor/ir/geometry-ir.ts
function deg2rad(d) {
  return d * Math.PI / 180;
}
function rotateAbout(p, center, deg) {
  if (!deg) return p;
  const theta = deg2rad(deg);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}
function layoutForm(form) {
  const geom = geometryFor(form.shape);
  const n = geom.nodeSize(form) * (form.scale ?? 1);
  const [ccx, ccy] = bodyCentroid(geom.body);
  const center = { x: form.position.x + ccx * n, y: form.position.y + ccy * n };
  const rotation = form.rotation ?? 0;
  const toAbs = (local) => rotateAbout({ x: form.position.x + local.x, y: form.position.y + local.y }, center, rotation);
  return { form, n, center, rotation, toAbs };
}
function formBodyVerticesPx(form) {
  const geom = geometryFor(form.shape);
  if (geom.body.type !== "polygon") return null;
  const { n, toAbs } = layoutForm(form);
  return geom.body.pointsFrac.map(([fx, fy]) => toAbs({ x: fx * n, y: fy * n }));
}
function pointPositionsPx(diagram) {
  const out = /* @__PURE__ */ new Map();
  for (const form of diagram.forms) {
    const layout = layoutForm(form);
    const geom = geometryFor(form.shape);
    for (const edgeKey of geom.edgeKeys) {
      const ids = pointIdsAt(form, edgeKey);
      ids.forEach((pid, index) => {
        const anchor = geom.pointAnchor(edgeKey, index, ids.length, layout.n);
        const local = { x: anchor.x, y: anchor.y };
        out.set(pid, {
          pos: layout.toAbs(local),
          local,
          cardinal: String(anchor.position),
          layout,
          edgeKey,
          siblingIndex: index,
          siblingCount: ids.length
        });
      });
    }
  }
  return out;
}
var FORM_FILL_OPACITY = 0.18;
var FORM_STROKE_PT = 0.4;
var LINE_STROKE_PT = 0.4;
var POINT_GLYPH_R = POINT_SIZE / 2;
var LABEL_GAP_H_PX = 14;
var LABEL_GAP_V_PX = 11;
var SPLAY_PX = 40;
var WHITE = [1, 1, 1];
function flattenOverWhite(color, fillOpacity) {
  return color.map((c) => 1 - fillOpacity + fillOpacity * c);
}
function glyphLocalPoints(shape) {
  const r = POINT_GLYPH_R;
  switch (shape) {
    case "square":
      return [[-r, -r], [r, -r], [r, r], [-r, r]];
    case "triangle":
      return [[r, 0], [-r * 0.5, r * 0.866], [-r * 0.5, -r * 0.866]];
    case "rhombus":
      return [[0, -r], [r, 0], [0, r], [-r, 0]];
    default:
      return null;
  }
}
function labelAnchorFor(cardinal) {
  switch (cardinal) {
    case "left":
      return { offset: { x: -LABEL_GAP_H_PX, y: 0 }, anchor: "east" };
    // label sits to the LEFT -> its own east edge touches the point
    case "right":
      return { offset: { x: LABEL_GAP_H_PX, y: 0 }, anchor: "west" };
    case "top":
      return { offset: { x: 0, y: -LABEL_GAP_V_PX }, anchor: "south" };
    default:
      return { offset: { x: 0, y: LABEL_GAP_V_PX }, anchor: "north" };
  }
}
function buildPointCmds(pt, px, cmds) {
  const fillColor = pt.color ? flattenOverWhite(pt.color, FORM_FILL_OPACITY) : WHITE;
  const local = px.layout.toAbs;
  switch (pt.shape) {
    case "empty":
      break;
    // nothing drawn — the coordinate still exists as a line endpoint
    case "circle":
      cmds.push({ kind: "pointCircle", pos: px.pos, radiusPx: POINT_GLYPH_R, fillColor });
      break;
    default: {
      const glyph = glyphLocalPoints(pt.shape);
      if (!glyph) break;
      const pts = glyph.map(([dx, dy]) => local({ x: px.local.x + dx, y: px.local.y + dy }));
      cmds.push({ kind: "pointPolygon", pts, fillColor });
      break;
    }
  }
}
function buildFormCmds(form, cmds) {
  const geom = geometryFor(form.shape);
  if (geom.bodyOpacity <= 0) return;
  const layout = layoutForm(form);
  const body = geom.body;
  if (body.type === "polygon") {
    cmds.push({
      kind: "polygon",
      pts: formBodyVerticesPx(form),
      fillColor: form.color,
      fillOpacity: FORM_FILL_OPACITY,
      strokeColor: "black",
      strokeWidthPt: FORM_STROKE_PT
    });
  } else {
    cmds.push({
      kind: "circle",
      center: layout.center,
      radiusPx: layout.n / 2,
      fillColor: form.color,
      fillOpacity: FORM_FILL_OPACITY,
      strokeColor: "black",
      strokeWidthPt: FORM_STROKE_PT
    });
  }
  if (geom.showName) {
    const [cfx, cfy] = bodyCentroid(body);
    const labelAt = layout.toAbs({ x: cfx * layout.n, y: cfy * layout.n });
    cmds.push({ kind: "label", at: labelAt, text: mathWrap(form.name ?? form.id), masked: false });
  }
}
function edgeLabelSplayLocal(px) {
  const { edgeKey, siblingIndex: index, siblingCount: count, layout } = px;
  if (count <= 1) return { x: 0, y: 0 };
  const mid = (count - 1) / 2;
  const sign = Math.sign(index - mid);
  if (sign === 0) return { x: 0, y: 0 };
  const geom = geometryFor(layout.form.shape);
  const start = geom.pointAnchor(edgeKey, 0, count, layout.n);
  const end = geom.pointAnchor(edgeKey, count - 1, count, layout.n);
  const tx = end.x - start.x;
  const ty = end.y - start.y;
  const len = Math.hypot(tx, ty);
  if (len < 1e-6) return { x: 0, y: 0 };
  const sAbs = layout.toAbs({ x: start.x, y: start.y });
  const eAbs = layout.toAbs({ x: end.x, y: end.y });
  if (Math.abs(eAbs.y - sAbs.y) > Math.abs(eAbs.x - sAbs.x)) return { x: 0, y: 0 };
  return { x: sign * SPLAY_PX * tx / len, y: sign * SPLAY_PX * ty / len };
}
function buildPointLabelCmd(pt, px) {
  if (!pt.name) return null;
  const screenDir = screenCardinal(px.cardinal, px.layout.rotation);
  const { offset, anchor } = labelAnchorFor(screenDir);
  const splay = edgeLabelSplayLocal(px);
  const base = px.layout.toAbs({ x: px.local.x + splay.x, y: px.local.y + splay.y });
  const at = { x: base.x + offset.x, y: base.y + offset.y };
  return { kind: "label", at, text: mathWrap(pt.name), anchor, masked: false };
}
function buildPointLabelMaskCmd(pt, px) {
  const label = buildPointLabelCmd(pt, px);
  if (!label || label.kind !== "label") return null;
  return { ...label, masked: true, maskOnly: true };
}
function pointDir(px) {
  return worldPointNormal(px.layout.form, px.edgeKey, px.siblingIndex, px.siblingCount);
}
function buildLineCmds(diagram, positions, cmds) {
  const style = diagram.edgeStyle ?? "straight";
  const labelCmds = [];
  for (const line of diagram.lines) {
    const src = positions.get(line.source);
    if (!src) continue;
    const elbow = line.targets.length > 1 ? "source" : "mid";
    line.targets.forEach((tid) => {
      const tgt = positions.get(tid);
      if (!tgt) return;
      const fromDir = pointDir(src);
      const toDir = pointDir(tgt);
      const wp = wirePath(src.pos.x, src.pos.y, fromDir, tgt.pos.x, tgt.pos.y, toDir, style, elbow);
      const elbowPoints = style === "smoothstep" && !isNearlyStraight(src.pos.x, src.pos.y, tgt.pos.x, tgt.pos.y) ? smoothstepElbowPoints(src.pos.x, src.pos.y, fromDir, tgt.pos.x, tgt.pos.y, toDir, elbow) : void 0;
      cmds.push({
        kind: "line",
        from: src.pos,
        to: tgt.pos,
        color: line.color ?? "black",
        widthPt: LINE_STROKE_PT,
        style,
        d: wp.d,
        c1: wp.c1,
        c2: wp.c2,
        elbowPoints,
        mid: wp.mid
      });
      if (line.name) {
        labelCmds.push({ kind: "label", at: wp.mid, text: mathWrap(line.name), masked: true });
      }
    });
  }
  cmds.push(...labelCmds);
}
function mathWrap(text2) {
  return `$${text2}$`;
}
function cmdVecs(cmd) {
  switch (cmd.kind) {
    case "polygon":
      return cmd.pts;
    case "circle":
      return [cmd.center];
    case "pointCircle":
      return [cmd.pos];
    case "pointPolygon":
      return cmd.pts;
    case "line": {
      const vecs = [cmd.from, cmd.to];
      if (cmd.c1) vecs.push(cmd.c1);
      if (cmd.c2) vecs.push(cmd.c2);
      if (cmd.elbowPoints) vecs.push(...cmd.elbowPoints);
      return vecs;
    }
    case "label":
      return [cmd.at];
  }
}
var SHARE_BASE = "https://semiotics.nesycat.org/editor";
function buildDrawCmds(diagram) {
  const cmds = [];
  const positions = pointPositionsPx(diagram);
  buildLineCmds(diagram, positions, cmds);
  const eachPoint = (fn) => {
    for (const form of diagram.forms) {
      const geom = geometryFor(form.shape);
      for (const edgeKey of geom.edgeKeys) {
        pointIdsAt(form, edgeKey).forEach((pid) => {
          const pt = diagram.points[pid];
          const px = positions.get(pid);
          if (pt && px) fn(pt, px);
        });
      }
    }
  };
  eachPoint((pt, px) => {
    const m = buildPointLabelMaskCmd(pt, px);
    if (m) cmds.push(m);
  });
  for (const form of diagram.forms) buildFormCmds(form, cmds);
  eachPoint((pt, px) => buildPointCmds(pt, px, cmds));
  eachPoint((pt, px) => {
    const l = buildPointLabelCmd(pt, px);
    if (l) cmds.push(l);
  });
  return cmds;
}

// ../components/editor/export/tikz.ts
function fmt2(n) {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1e3) / 1e3;
  let s = rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (s === "" || s === "-0") s = "0";
  return s;
}
function coord(v, minX, maxY) {
  return `${fmt2((v.x - minX) / 100)},${fmt2((maxY - v.y) / 100)}`;
}
function lenCm(px) {
  return fmt2(px / 100);
}
var ColorRegistry = class {
  constructor() {
    this.names = /* @__PURE__ */ new Map();
    this.lines = [];
  }
  key(c) {
    const k = c.map((ch) => fmt2(ch)).join(",");
    const existing = this.names.get(k);
    if (existing) return existing;
    const name = `nesyColor${this.names.size}`;
    this.names.set(k, name);
    this.lines.push(`\\definecolor{${name}}{rgb}{${k}}`);
    return name;
  }
  definitions() {
    return this.lines;
  }
};
function tikzColorRef(c, registry) {
  if (c === void 0 || c === "black") return "black";
  return registry.key(c);
}
function emitCmd(cmd, registry, minX, maxY) {
  const c = (v) => coord(v, minX, maxY);
  switch (cmd.kind) {
    case "polygon": {
      const path2 = cmd.pts.map((p) => `(${c(p)})`).join(" -- ");
      const stroke = tikzColorRef(cmd.strokeColor, registry);
      if (cmd.fillColor) {
        const fill = tikzColorRef(cmd.fillColor, registry);
        return `\\filldraw[fill=${fill}, fill opacity=${fmt2(cmd.fillOpacity)}, draw=${stroke}, line width=${cmd.strokeWidthPt}pt] ${path2} -- cycle;`;
      }
      return `\\draw[draw=${stroke}, line width=${cmd.strokeWidthPt}pt] ${path2} -- cycle;`;
    }
    case "circle": {
      const stroke = cmd.strokeColor ? tikzColorRef(cmd.strokeColor, registry) : null;
      const r = lenCm(cmd.radiusPx);
      if (cmd.fillColor) {
        const fill = tikzColorRef(cmd.fillColor, registry);
        return `\\filldraw[fill=${fill}, fill opacity=${fmt2(cmd.fillOpacity)}, draw=${stroke ?? "black"}, line width=${cmd.strokeWidthPt ?? FORM_STROKE_PT}pt] (${c(cmd.center)}) circle (${r});`;
      }
      return `\\draw[draw=${stroke ?? "black"}, line width=${cmd.strokeWidthPt ?? FORM_STROKE_PT}pt] (${c(cmd.center)}) circle (${r});`;
    }
    case "pointCircle": {
      const fill = tikzColorRef(cmd.fillColor, registry);
      return `\\filldraw[fill=${fill}, draw=black, line width=${FORM_STROKE_PT}pt] (${c(cmd.pos)}) circle (${lenCm(cmd.radiusPx)});`;
    }
    case "pointPolygon": {
      const fill = tikzColorRef(cmd.fillColor, registry);
      const path2 = cmd.pts.map((p) => `(${c(p)})`).join(" -- ");
      return `\\filldraw[fill=${fill}, draw=black, line width=${FORM_STROKE_PT}pt] ${path2} -- cycle;`;
    }
    case "line": {
      const color = tikzColorRef(cmd.color, registry);
      const opts = `${color}, line width=${cmd.widthPt}pt`;
      if (cmd.style === "bezier" && cmd.c1 && cmd.c2) {
        return `\\draw[${opts}] (${c(cmd.from)}) .. controls (${c(cmd.c1)}) and (${c(cmd.c2)}) .. (${c(cmd.to)});`;
      }
      if (cmd.style === "smoothstep" && cmd.elbowPoints && cmd.elbowPoints.length > 2) {
        const path2 = cmd.elbowPoints.map((p) => `(${c(p)})`).join(" -- ");
        return `\\draw[${opts}, rounded corners=${lenCm(STEP_RADIUS)}] ${path2};`;
      }
      return `\\draw[${opts}] (${c(cmd.from)}) -- (${c(cmd.to)});`;
    }
    case "label": {
      const opts = [
        ...cmd.masked ? ["fill=white", "inner sep=2pt"] : [],
        ...cmd.maskOnly ? ["text opacity=0"] : [],
        ...cmd.anchor ? [`anchor=${cmd.anchor}`] : []
      ];
      const opt = opts.length ? `[${opts.join(", ")}] ` : " ";
      return `\\node${opt}at (${c(cmd.at)}) {${cmd.text}};`;
    }
  }
}
function diagramToTikzCore(diagram, fragment) {
  const cmds = buildDrawCmds(diagram);
  const allVecs = cmds.flatMap(cmdVecs);
  const minX = allVecs.length ? Math.min(...allVecs.map((v) => v.x)) : 0;
  const maxY = allVecs.length ? Math.max(...allVecs.map((v) => v.y)) : 0;
  const registry = new ColorRegistry();
  const body = cmds.map((cmd) => emitCmd(cmd, registry, minX, maxY));
  const header = [
    "% Exported from NeSyCat Semiotics",
    fragment ? `% ${SHARE_BASE}#${fragment}` : null
  ].filter((l) => l !== null);
  return [
    ...header,
    "\\makeatletter\\@ifundefined{nesycatfig}{%",
    "\\newsavebox\\nesycatfigbox",
    "\\newenvironment{nesycatfig}{\\par\\begin{lrbox}{\\nesycatfigbox}}{\\end{lrbox}\\begin{center}%",
    "\\@ifundefined{resizebox}{\\usebox{\\nesycatfigbox}}{%",
    "\\ifdim\\wd\\nesycatfigbox>\\linewidth\\resizebox{\\linewidth}{!}{\\usebox{\\nesycatfigbox}}%",
    "\\else\\usebox{\\nesycatfigbox}\\fi}%",
    "\\end{center}}%",
    "}{}\\makeatother",
    "\\begin{nesycatfig}%",
    "\\begin{tikzpicture}",
    ...registry.definitions().map((l) => `  ${l}`),
    ...body.map((l) => `  ${l}`),
    "\\end{tikzpicture}",
    "\\end{nesycatfig}"
  ].join("\n");
}

// ../components/editor/domain/color.ts
var DEFAULT_COLOR = [52 / 255, 120 / 255, 246 / 255];
function chan(c) {
  return Math.round(c * 255);
}
function toRgbTriple(c) {
  return `${chan(c[0])}, ${chan(c[1])}, ${chan(c[2])}`;
}

// ../components/editor/export/html.ts
var INK = "#111111";
var PAD = 12;
var FORM_STROKE = 1.5;
var LABEL_CHAR_W = 8.4;
var LABEL_HALF_H = 9;
function colorRef(c) {
  if (c === void 0 || c === "black") return "black";
  return `rgb(${toRgbTriple(c)})`;
}
function unwrapMath(text2) {
  return text2.length >= 2 && text2.startsWith("$") && text2.endsWith("$") ? text2.slice(1, -1) : text2;
}
var TEX_WRAPPERS = /\\(?:mathtt|texttt|mathrm|textrm|mathbf|textbf|mathit|textit|mathsf|textsf|mathcal|mathbb|mathfrak|text|operatorname|emph|mbox)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
function latexToPlain(text2) {
  let t = text2;
  let prev;
  do {
    prev = t;
    t = t.replace(TEX_WRAPPERS, "$1");
  } while (t !== prev);
  t = t.replace(/\\([_%&#$·{}])/g, "$1");
  t = t.replace(/\\[,;:! ]/g, " ");
  t = t.replace(/[{}]/g, "");
  return t;
}
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function round(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
var MASK_PAD = 2;
function labelHalfExtents(text2, anchor) {
  const w = text2.length * LABEL_CHAR_W;
  const left = anchor === "west" ? 0 : anchor === "east" ? w : w / 2;
  const right = anchor === "east" ? 0 : anchor === "west" ? w : w / 2;
  return { left, right };
}
var ANCHOR_MAP = { east: "end", west: "start", north: "middle", south: "middle" };
function emitCmd2(cmd) {
  switch (cmd.kind) {
    case "polygon": {
      const pts = cmd.pts.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
      const fillAttr = cmd.fillColor ? ` fill="${colorRef(cmd.fillColor)}" fill-opacity="${cmd.fillOpacity}"` : ' fill="none"';
      return `<polygon points="${pts}"${fillAttr} stroke="${colorRef(cmd.strokeColor)}" stroke-width="${FORM_STROKE}"/>`;
    }
    case "circle": {
      const fillAttr = cmd.fillColor ? ` fill="${colorRef(cmd.fillColor)}" fill-opacity="${cmd.fillOpacity}"` : ' fill="none"';
      const strokeAttr = cmd.strokeColor ? ` stroke="${colorRef(cmd.strokeColor)}" stroke-width="${FORM_STROKE}"` : "";
      return `<circle cx="${round(cmd.center.x)}" cy="${round(cmd.center.y)}" r="${round(cmd.radiusPx)}"${fillAttr}${strokeAttr}/>`;
    }
    case "pointCircle":
      return `<circle cx="${round(cmd.pos.x)}" cy="${round(cmd.pos.y)}" r="${round(cmd.radiusPx)}" fill="${colorRef(cmd.fillColor)}" stroke="black" stroke-width="1.5"/>`;
    case "pointPolygon": {
      const pts = cmd.pts.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
      return `<polygon points="${pts}" fill="${colorRef(cmd.fillColor)}" stroke="black" stroke-width="1.5"/>`;
    }
    case "line":
      return `<path d="${cmd.d}" fill="none" stroke="${colorRef(cmd.color)}" stroke-width="1.5"/>`;
    case "label": {
      const anchor = cmd.anchor ? ANCHOR_MAP[cmd.anchor] ?? "middle" : "middle";
      const text2 = latexToPlain(unwrapMath(cmd.text));
      const textEl = `<text x="${round(cmd.at.x)}" y="${round(cmd.at.y)}" text-anchor="${anchor}" dominant-baseline="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="14" fill="${INK}">${esc(text2)}</text>`;
      if (!cmd.masked) return textEl;
      const { left, right } = labelHalfExtents(text2, cmd.anchor);
      const rectX = cmd.at.x - left - MASK_PAD;
      const rectY = cmd.at.y - LABEL_HALF_H - MASK_PAD;
      const rectW = left + right + MASK_PAD * 2;
      const rectH = LABEL_HALF_H * 2 + MASK_PAD * 2;
      const rect = `<rect x="${round(rectX)}" y="${round(rectY)}" width="${round(rectW)}" height="${round(rectH)}" fill="white"/>`;
      if (cmd.maskOnly) return rect;
      return `${rect}
  ${textEl}`;
    }
  }
}
function cmdBoundsVecs(cmd) {
  switch (cmd.kind) {
    case "circle": {
      const { center, radiusPx: r } = cmd;
      return [{ x: center.x - r, y: center.y - r }, { x: center.x + r, y: center.y + r }];
    }
    case "pointCircle": {
      const { pos, radiusPx: r } = cmd;
      return [{ x: pos.x - r, y: pos.y - r }, { x: pos.x + r, y: pos.y + r }];
    }
    case "label": {
      const { left, right } = labelHalfExtents(unwrapMath(cmd.text), cmd.anchor);
      return [
        { x: cmd.at.x - left - MASK_PAD, y: cmd.at.y - LABEL_HALF_H - MASK_PAD },
        { x: cmd.at.x + right + MASK_PAD, y: cmd.at.y + LABEL_HALF_H + MASK_PAD }
      ];
    }
    default:
      return cmdVecs(cmd);
  }
}
function diagramToHtmlCore(diagram, fragment) {
  const cmds = buildDrawCmds(diagram);
  const allVecs = cmds.flatMap(cmdBoundsVecs);
  const minX = allVecs.length ? Math.min(...allVecs.map((v) => v.x)) : 0;
  const minY = allVecs.length ? Math.min(...allVecs.map((v) => v.y)) : 0;
  const maxX = allVecs.length ? Math.max(...allVecs.map((v) => v.x)) : 0;
  const maxY = allVecs.length ? Math.max(...allVecs.map((v) => v.y)) : 0;
  const w = Math.max(1, maxX - minX + PAD * 2);
  const h = Math.max(1, maxY - minY + PAD * 2);
  const body = cmds.map(emitCmd2).join("\n  ");
  const comment = fragment ? `<!-- ${SHARE_BASE}#${fragment} -->
` : "";
  return `${comment}<!-- Exported from NeSyCat Semiotics -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(minX - PAD)} ${round(minY - PAD)} ${round(w)} ${round(h)}" width="${round(w)}" height="${round(h)}">
  ${body}
</svg>`;
}

// ../components/editor/export/prisma.ts
var SCALARS = /* @__PURE__ */ new Set([
  "String",
  "Int",
  "Float",
  "Boolean",
  "DateTime",
  "ObjectId",
  "Json",
  "Bytes",
  "BigInt",
  "Decimal"
]);
function plain(s) {
  if (!s) return "";
  const wrap = /\\(?:mathtt|texttt|mathrm|textrm|mathbf|textbf|mathit|textit|mathsf|textsf|text|operatorname)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  let t = s;
  let prev;
  do {
    prev = t;
    t = t.replace(wrap, "$1");
  } while (t !== prev);
  return t.replace(/\\[a-zA-Z]+/g, "").replace(/[{}$]/g, "").trim();
}
var MONGO_DIALECT = { idField: 'id ObjectId @id @map("_id")', fkType: "ObjectId" };
var POSTGRES_DIALECT = { idField: "id Uuid @id @default(uuid())", fkType: "Uuid" };
function render(d, dialect) {
  const form = (id) => d.forms.find((f) => f.id === id);
  const pt = (id) => d.points[id];
  const outWires = (fid) => d.lines.filter((l) => !!l.source && pt(l.source)?.formId === fid);
  const isModel = (f) => !!f && f.shape === "square" && plain(f.name) !== "";
  const isComposite = (f) => !!f && f.shape === "circle";
  const modelForms = d.forms.filter(isModel);
  const single = (p) => p.shape === "rhombus";
  const optional = (p) => !!p.color;
  const modifierOf = (p) => !single(p) ? "[]" : optional(p) ? "?" : "";
  const discOf = {};
  const baseOf = {};
  const discWireIds = /* @__PURE__ */ new Set();
  for (const tri of d.forms.filter((f) => f.shape === "triangle")) {
    const peakPts = new Set(tri.edges["peak"] ?? []);
    const basePts = new Set(tri.edges["c"] ?? []);
    const peakWire = d.lines.find((l) => l.targets.some((t) => peakPts.has(t)));
    if (!peakWire) continue;
    const baseForm = form(pt(peakWire.source)?.formId ?? "");
    if (!isModel(baseForm)) continue;
    const baseModel = plain(baseForm.name);
    const field = plain(peakWire.name) || "kind";
    const peakLabel = plain(pt([...peakPts][0] ?? "")?.name);
    const type = peakLabel && SCALARS.has(peakLabel) ? peakLabel : "String";
    discOf[baseModel] = { field, type };
    discWireIds.add(peakWire.id);
    for (const bw of d.lines.filter((l) => l.targets.some((t) => basePts.has(t)))) {
      const vForm = form(pt(bw.source)?.formId ?? "");
      if (!isModel(vForm)) continue;
      baseOf[plain(vForm.name)] = { base: baseModel, tag: plain(bw.name) };
      discWireIds.add(bw.id);
    }
  }
  const typeBlocks = {};
  function fieldLines(l) {
    if (discWireIds.has(l.id)) return [];
    const tp = pt(l.targets[0]);
    if (!tp) return [];
    const tf = form(tp.formId);
    const fname = plain(l.name);
    if (isModel(tf)) {
      const src = pt(l.source);
      const uniq = src && single(src) ? " @unique" : "";
      const opt = optional(tp) ? "?" : "";
      return [
        `  ${fname}Id ${dialect.fkType}${uniq}`,
        `  ${fname} ${plain(tf.name)}${opt} @relation(fields: [${fname}Id], references: [id])`
      ];
    }
    if (isComposite(tf)) {
      const typeName = plain(tf.name) || plain(tp.name);
      buildType(typeName, tf.id);
      return [`  ${fname} ${typeName}${modifierOf(tp)}`];
    }
    return [`  ${fname} ${plain(tp.name)}${modifierOf(tp)}`];
  }
  function buildType(name, formId) {
    if (typeBlocks[name]) return;
    const lines = [];
    typeBlocks[name] = lines;
    for (const l of outWires(formId)) lines.push(...fieldLines(l));
  }
  const blocks = [];
  for (const mf of modelForms) {
    const name = plain(mf.name);
    const fields = [];
    const attrs = [];
    if (baseOf[name]) attrs.push(`  @@base(${baseOf[name].base}, "${baseOf[name].tag}")`);
    else fields.push(`  ${dialect.idField}`);
    for (const l of outWires(mf.id)) fields.push(...fieldLines(l));
    if (discOf[name]) {
      fields.push(`  ${discOf[name].field} ${discOf[name].type}`);
      attrs.push(`  @@discriminator(${discOf[name].field})`);
    }
    blocks.push(`model ${name} {
${[...fields, ...attrs].join("\n")}
}`);
  }
  for (const [name, lines] of Object.entries(typeBlocks)) blocks.push(`type ${name} {
${lines.join("\n")}
}`);
  return `// use prisma-next
// Generated from a NeSyCat Semiotics diagram.

${blocks.join("\n\n")}
`;
}
function diagramToPrisma(d) {
  return render(d, MONGO_DIALECT);
}
function diagramToPrismaPostgres(d) {
  return render(d, POSTGRES_DIALECT);
}

// src/tools/import_export.ts
function registerImportExportTools(server2, getClient2) {
  server2.registerTool(
    "import_diagram",
    {
      title: "Import diagram",
      description: "Parse a diagram JSON string, validate it (same checks as validate_diagram), and create it as a new diagram. Refuses to create if validation finds dangling references \u2014 call validate_diagram first to see them, fix the JSON, and retry.",
      inputSchema: { title: z4.string().min(1), json: z4.string(), organizationId: z4.string().uuid().optional() }
    },
    async ({ title, json, organizationId }) => {
      let parsed;
      try {
        parsed = JSON.parse(json);
      } catch (e) {
        return errorText(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
      const validated2 = validateDiagram(parsed);
      if (!validated2.ok) {
        return errorText(`Diagram has dangling references, refusing to import:
${validated2.problems.join("\n")}`);
      }
      const client = getClient2();
      const resolved = await resolveOrganizationId(client, organizationId);
      if ("error" in resolved) return errorText(resolved.error);
      const { data: row, error } = await client.from("diagrams").insert({ title, organization_id: resolved.organizationId, data: validated2.diagram }).select("*").single();
      if (error) return errorText(error.message);
      return text(row);
    }
  );
  server2.registerTool(
    "export_diagram",
    {
      title: "Export diagram",
      description: "Export a diagram as json (the raw data blob), tikz (LaTeX/TikZ source), html (a self-contained SVG snippet), prisma (a Document/MongoDB Prisma Next schema generated from the diagram's models/fields/multiplicities), or prisma-postgres (the same schema targeting Postgres/relational \u2014 Uuid ids, no @map).",
      inputSchema: { id: z4.string().uuid(), format: z4.enum(["json", "tikz", "html", "prisma", "prisma-postgres"]) }
    },
    async ({ id, format }) => {
      const { data: row, error } = await getClient2().from("diagrams").select("*").eq("id", id).maybeSingle();
      if (error) return errorText(error.message);
      if (!row) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`);
      const diagram = restoreDiagram(row.data);
      if (format === "json") return text({ id, format, content: diagram });
      if (format === "tikz") return text({ id, format, content: diagramToTikzCore(diagram) });
      if (format === "prisma") return text({ id, format, content: diagramToPrisma(diagram) });
      if (format === "prisma-postgres") return text({ id, format, content: diagramToPrismaPostgres(diagram) });
      return text({ id, format, content: diagramToHtmlCore(diagram) });
    }
  );
}

// src/index.ts
var server = new McpServer({ name: "nesycat-semiotics", version: "0.1.0" });
var getClient = () => getSupabaseClient();
registerWhoamiTools(server, getClient);
registerOrganizationTools(server, getClient);
registerDiagramTools(server, getClient);
registerDrawingTools(server, getClient);
registerValidateTools(server);
registerImportExportTools(server, getClient);
var transport = new StdioServerTransport();
await server.connect(transport);
