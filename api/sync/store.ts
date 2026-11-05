// 同步与滚动备份：服务端（可以就是你的手机）上的一份数据 + 一串历史快照。
//   current.json   最新数据与版本号 rev；每次写入原子替换（先写临时文件再改名），断电也不会写坏
//   backups/       快照：距上一份超过 10 分钟的写入留一份；2 天内全留，2–90 天每天留最后一份，更早的删掉
// 只依赖 node:fs，单用户、同步读写，足够简单可靠。
import fs from "node:fs";
import path from "node:path";

export interface SyncDoc { rev: number; updatedAt: string; device?: string; data: unknown }
export type PutResult = { ok: true; rev: number; updatedAt: string; snapshot?: string } | { ok: false; current: SyncDoc };

const SNAPSHOT_GAP_MS = 10 * 60 * 1000;
const KEEP_ALL_MS = 2 * 24 * 60 * 60 * 1000;
const KEEP_DAILY_MS = 90 * 24 * 60 * 60 * 1000;
const NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})_r(\d+)\.json$/;

const pad = (n: number) => String(n).padStart(2, "0");
/** 用服务端所在时区的本地时间命名，手机上看文件名就是当地时间 */
function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function parseStamp(name: string): Date | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [y, mo, d] = m[1].split("-").map(Number);
  return new Date(y, mo - 1, d, Number(m[2]), Number(m[3]), Number(m[4]));
}

function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function createSyncStore(dir: string) {
  const currentFile = path.join(dir, "current.json");
  const backupDir = path.join(dir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  function get(): SyncDoc {
    try {
      const doc = JSON.parse(fs.readFileSync(currentFile, "utf8")) as SyncDoc;
      if (typeof doc.rev === "number") return doc;
    } catch { /* 还没有数据 */ }
    return { rev: 0, updatedAt: "", data: null };
  }

  function listBackups(): { name: string; at: string; rev: number; size: number }[] {
    return fs.readdirSync(backupDir)
      .filter((name) => NAME.test(name))
      .sort()
      .reverse()
      .map((name) => ({ name, at: parseStamp(name)!.toISOString(), rev: Number(NAME.exec(name)![5]), size: fs.statSync(path.join(backupDir, name)).size }));
  }

  function prune(now: Date) {
    const seenDays = new Set<string>();
    // 新到旧：2 天内全留；2–90 天每天只留最新一份；更早删除
    for (const { name } of listBackups()) {
      const at = parseStamp(name)!;
      const age = now.getTime() - at.getTime();
      const day = name.slice(0, 10);
      const keep = age <= KEEP_ALL_MS || (age <= KEEP_DAILY_MS && !seenDays.has(day));
      if (age > KEEP_ALL_MS) seenDays.add(day);
      if (!keep) fs.rmSync(path.join(backupDir, name), { force: true });
    }
  }

  function snapshot(doc: SyncDoc, now: Date, force = false): string | undefined {
    const latest = listBackups()[0];
    if (!force && latest && now.getTime() - new Date(latest.at).getTime() < SNAPSHOT_GAP_MS) return undefined;
    const name = `${stamp(now)}_r${doc.rev}.json`;
    writeAtomic(path.join(backupDir, name), JSON.stringify(doc.data));
    prune(now);
    return name;
  }

  /** 只有 baseRev 等于当前版本才写入；否则返回服务端的最新数据，由客户端合并后重试 */
  function put(baseRev: number, data: unknown, device: string | undefined, now = new Date()): PutResult {
    const current = get();
    if (baseRev !== current.rev) return { ok: false, current };
    // 覆盖前先给旧版本留一份，避免一次误操作把好数据冲掉
    if (current.rev > 0) snapshot(current, now);
    const next: SyncDoc = { rev: current.rev + 1, updatedAt: now.toISOString(), device, data };
    writeAtomic(currentFile, JSON.stringify(next));
    const snap = current.rev === 0 ? snapshot(next, now, true) : undefined;
    return { ok: true, rev: next.rev, updatedAt: next.updatedAt, snapshot: snap };
  }

  function readBackup(name: string): string | null {
    if (!NAME.test(name)) return null;
    try { return fs.readFileSync(path.join(backupDir, name), "utf8"); } catch { return null; }
  }

  return { dir, get, put, listBackups, readBackup, snapshot, prune };
}

export type SyncStore = ReturnType<typeof createSyncStore>;
