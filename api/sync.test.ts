import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSyncStore } from "./sync/store";
import { mergeData } from "../src/lib/syncMerge";
import type { AppData, Item } from "../src/types";

let dir = "";
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "cike-sync-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const data = (names: string[]) => ({ version: 3, items: names.map((name) => ({ id: name, name })), checkIns: [], settings: { capacityMinutesPerDay: 180 } });
const at = (s: string) => new Date(s);

describe("同步存储", () => {
  it("版本号递增；拿旧版本写会冲突并返回最新数据", () => {
    const store = createSyncStore(dir);
    expect(store.get().rev).toBe(0);
    expect(store.put(0, data(["a"]), "手机", at("2026-11-01T10:00:00"))).toMatchObject({ ok: true, rev: 1 });
    expect(store.put(1, data(["a", "b"]), "手机", at("2026-11-01T10:01:00"))).toMatchObject({ ok: true, rev: 2 });
    const stale = store.put(1, data(["c"]), "电脑", at("2026-11-01T10:02:00"));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect((stale.current.data as { items: unknown[] }).items).toHaveLength(2);
    expect(fs.existsSync(path.join(dir, "current.json"))).toBe(true);
  });

  it("快照：第一次写入就留一份；10 分钟内的改动不重复留；覆盖前给旧版本留一份", () => {
    const store = createSyncStore(dir);
    store.put(0, data(["a"]), undefined, at("2026-11-01T10:00:00"));
    expect(store.listBackups()).toHaveLength(1);
    store.put(1, data(["a", "b"]), undefined, at("2026-11-01T10:05:00"));
    expect(store.listBackups()).toHaveLength(1);
    store.put(2, data(["a", "b", "c"]), undefined, at("2026-11-01T10:20:00"));
    const backups = store.listBackups();
    expect(backups).toHaveLength(2);
    expect(backups[0].rev).toBe(2);
    expect(JSON.parse(store.readBackup(backups[0].name)!).items).toHaveLength(2);
  });

  it("保留规则：2 天内全留，之后每天留最后一份，90 天前的删掉", () => {
    const store = createSyncStore(dir);
    const doc = (rev: number) => ({ rev, updatedAt: "", data: data(["x"]) });
    let rev = 0;
    for (const t of ["2026-07-01T09:00:00", "2026-10-20T09:00:00", "2026-10-20T18:00:00", "2026-10-31T08:00:00", "2026-10-31T09:00:00", "2026-11-01T09:00:00"]) store.snapshot(doc(++rev), at(t), true);
    store.prune(at("2026-11-01T12:00:00"));
    const days = store.listBackups().map((b) => b.name.slice(0, 16));
    expect(days).toEqual(["2026-11-01T09-00", "2026-10-31T09-00", "2026-10-31T08-00", "2026-10-20T18-00"]);
  });

  it("备份文件名不能拿来读别的文件", () => {
    const store = createSyncStore(dir);
    expect(store.readBackup("../current.json")).toBeNull();
  });
});

describe("同步接口的访问控制", () => {
  it("本机访问不要口令；别的设备没口令被拒，带对口令可以", async () => {
    process.env.CIKE_DATA_DIR = dir;
    process.env.SYNC_TOKEN = "fish-123";
    const { syncRoutes } = await import("./routes/sync");
    const local = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
    const lan = { incoming: { socket: { remoteAddress: "192.168.1.8" } } };
    expect((await syncRoutes.request("/", {}, local)).status).toBe(200);
    expect((await syncRoutes.request("/", {}, lan)).status).toBe(403);
    expect((await syncRoutes.request("/", { headers: { Authorization: "Bearer wrong" } }, lan)).status).toBe(403);
    expect((await syncRoutes.request("/", { headers: { Authorization: "Bearer fish-123" } }, lan)).status).toBe(200);
    const status = await (await syncRoutes.request("/status", {}, lan)).json();
    expect(status).toMatchObject({ authorized: false, needsToken: true });
    const put = await syncRoutes.request("/", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRev: 0, data: data(["a"]) }) }, local);
    expect(await put.json()).toMatchObject({ rev: 1 });
    expect((await syncRoutes.request("/", { method: "PUT", body: JSON.stringify({ baseRev: 1, data: { hello: 1 } }) }, local)).status).toBe(400);
    delete process.env.SYNC_TOKEN;
  });
});

describe("合并两份数据", () => {
  const item = (id: string, name = id): Item => ({ id, name, category: "c", type: "once", priority: 2, intervalDays: 1, currentInterval: 1, dueDate: "2026-11-01", createdAt: "2026-11-01", paused: false });
  const app = (items: Item[], extra: Partial<AppData> = {}): AppData => ({ version: 3, items, checkIns: [], settings: { capacityMinutesPerDay: 180 }, ...extra });

  it("两边新加的都留下；同一件以本机为准；删除过的不会回来", () => {
    const local = app([item("a", "本机改过"), item("b")], { deleted: ["c"] });
    const remote = app([item("a", "旧名字"), item("c"), item("d")], { checkIns: [{ id: "k1", itemId: "c", doneAt: "x" }, { id: "k2", itemId: "d", doneAt: "x" }] });
    const merged = mergeData(local, remote);
    expect(merged.items.map((i) => `${i.id}:${i.name}`)).toEqual(["a:本机改过", "b:b", "d:d"]);
    expect(merged.checkIns.map((c) => c.id)).toEqual(["k2"]);
    expect(merged.deleted).toEqual(["c"]);
  });

  it("规划记录、周规划按键合并", () => {
    const h = (over: Partial<NonNullable<AppData["horizon"]>>) => ({ events: [], done: {}, dismissed: [], notes: {}, weekPlans: {}, dayNotes: {}, ...over });
    const local = app([], { horizon: h({ done: { "week:2026-11-02": "2026-11-01" }, dayNotes: { "2026-11-02": "先复习大物" } }) });
    const remote = app([], { horizon: h({ done: { "ev:x@7": "2026-10-31" }, weekPlans: { "2026-11-02": { weekStart: "2026-11-02", focus: "大物", fun: "看电影", savedAt: "" } } }) });
    const merged = mergeData(local, remote).horizon!;
    expect(Object.keys(merged.done).sort()).toEqual(["ev:x@7", "week:2026-11-02"]);
    expect(merged.weekPlans["2026-11-02"].fun).toBe("看电影");
    expect(merged.dayNotes["2026-11-02"]).toBe("先复习大物");
  });
});
