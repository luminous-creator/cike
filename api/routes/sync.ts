import { Hono, type Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { HttpBindings } from "@hono/node-server";
import { createSyncStore, type SyncStore } from "../sync/store";
import { log } from "../lib/logger";

// 同步只接受同源请求（应用就是从这台服务端打开的）：
//   - 本机（localhost）访问不需要口令，手机上自己用最方便；
//   - 其他设备（同一 Wi-Fi 的电脑等）要带 SYNC_TOKEN；没设口令时一律拒绝。
let store: SyncStore | null = null;
export function syncStore(): SyncStore {
  if (!store) store = createSyncStore(path.resolve(process.env.CIKE_DATA_DIR?.trim() || "cike-data"));
  return store;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function remoteAddress(c: Context<{ Bindings: HttpBindings }>): string | undefined {
  try { return c.env?.incoming?.socket?.remoteAddress ?? undefined; } catch { return undefined; }
}

export function isLocal(c: Context<{ Bindings: HttpBindings }>): boolean {
  const address = remoteAddress(c);
  // 开发服务器（vite）拿不到地址，它本来只听本机
  if (!address) return process.env.NODE_ENV !== "production";
  return LOOPBACK.has(address);
}

function tokenOk(c: Context): boolean {
  const expected = process.env.SYNC_TOKEN?.trim();
  const given = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const syncRoutes = new Hono<{ Bindings: HttpBindings }>();

syncRoutes.get("/status", (c) => {
  const allowed = isLocal(c) || tokenOk(c);
  if (!allowed) return c.json({ available: true, authorized: false, needsToken: true, tokenConfigured: Boolean(process.env.SYNC_TOKEN?.trim()) });
  const s = syncStore();
  const doc = s.get();
  const backups = s.listBackups();
  return c.json({ available: true, authorized: true, rev: doc.rev, updatedAt: doc.updatedAt || null, device: doc.device ?? null, backups: backups.length, latestBackup: backups[0]?.at ?? null, dataDir: s.dir });
});

syncRoutes.use("*", async (c, next) => {
  if (isLocal(c) || tokenOk(c)) return next();
  return c.json({ error: process.env.SYNC_TOKEN?.trim() ? "口令不对" : "这台服务端没设 SYNC_TOKEN，只允许本机访问" }, 403);
});

syncRoutes.get("/", (c) => c.json(syncStore().get()));

syncRoutes.put("/", async (c) => {
  const body = await c.req.json().catch(() => null) as { baseRev?: unknown; data?: unknown; device?: unknown } | null;
  const data = body?.data as { version?: unknown; items?: unknown; checkIns?: unknown } | undefined;
  if (!body || typeof body.baseRev !== "number" || !data || data.version !== 3 || !Array.isArray(data.items) || !Array.isArray(data.checkIns)) {
    return c.json({ error: "数据格式不正确" }, 400);
  }
  const result = syncStore().put(body.baseRev, data, typeof body.device === "string" ? body.device.slice(0, 60) : undefined);
  if (!result.ok) return c.json({ error: "conflict", ...result.current }, 409);
  if (result.snapshot) log.info("sync snapshot", { name: result.snapshot, rev: result.rev });
  return c.json({ rev: result.rev, updatedAt: result.updatedAt });
});

syncRoutes.get("/backups", (c) => c.json(syncStore().listBackups()));

syncRoutes.get("/backups/:name", (c) => {
  const name = c.req.param("name");
  const text = syncStore().readBackup(name);
  if (text === null) return c.json({ error: "没有这份备份" }, 404);
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="cike-${name}"`);
  return c.body(text);
});
