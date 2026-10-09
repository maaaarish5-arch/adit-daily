// Shared day store.
//
// Production: Upstash Redis (the Vercel KV integration injects KV_REST_API_URL /
// KV_REST_API_TOKEN). Adit ticks on his machine, Dr. Marish opens the same URL
// and sees the same state.
//
// Local dev with no env vars: a JSON file under .data/ so the app is runnable
// before anything is provisioned. Swapping backends means touching only this file.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { DayKey } from "./date";
import type { Ticks } from "./tasks";
import { cleanRoster, EMPTY_ROSTER, type Roster, type Student } from "./roster";
import {
  cleanLog,
  cleanMeeting,
  EMPTY_LOG,
  istDate,
  mergeFromCalendar,
  type CalendarPart,
  type Edit,
  type Meeting,
} from "./sales";
import { cleanTodos, type Todo } from "./todos";
import {
  cleanBuckets,
  cleanEvent,
  type LogEvent,
} from "./activity";
import { cleanTasks, EMPTY_DUMP, type DumpDoc, type DumpTask } from "./dump";
import {
  cleanEntries,
  EMPTY_CHECKIN,
  type CheckinDoc,
  type Entries,
} from "./checkin";

export type DayDoc = {
  ticks: Ticks;
  notes: string;
  updatedAt: string | null;
};

export const EMPTY_DAY: DayDoc = { ticks: {}, notes: "", updatedAt: null };

const PREFIX = "adit:day:";

const REST_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

/** A Vercel preview (any branch other than main). It must never write to the
 *  live store, but an empty roster is useless for checking a change — so it
 *  reads a copy of the live data and keeps every edit in memory. See below. */
export const previewSandbox = process.env.VERCEL_ENV === "preview";

export const usingRedis = Boolean(REST_URL && REST_TOKEN) || previewSandbox;

/* ---------------------------- preview sandbox ----------------------------- */
// Stands in for Redis on preview deployments. A key is filled the first time
// it is read, from the live site's own public GET routes; after that, reads and
// writes stay in this instance's memory. Nothing is ever sent back to the live
// site, and a cold start simply begins again from a fresh copy.

const LIVE_SITE = "https://usmlevault-daily.vercel.app";

const sandbox: Map<string, unknown> = ((globalThis as { __aditSandbox?: Map<string, unknown> })
  .__aditSandbox ??= new Map());

/** The live GET route that returns this key's document, if there is one. */
function liveRouteFor(key: string): string | null {
  if (key === "adit:roster") return "/api/roster";
  if (key === "adit:todos") return "/api/todos";
  let m = /^adit:checkin:(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (m) return `/api/checkin?date=${m[1]}`;
  m = /^adit:day:(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (m) return `/api/day?date=${m[1]}`;
  m = /^adit:corner:([a-z]+):(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (m) return `/api/corner?person=${m[1]}&date=${m[2]}`;
  return null;
}

async function sandboxGet(key: string): Promise<unknown> {
  if (!sandbox.has(key)) {
    const route = liveRouteFor(key);
    let value: unknown = null;
    if (route) {
      try {
        const res = await fetch(LIVE_SITE + route, { cache: "no-store" });
        if (res.ok) value = await res.text();
      } catch {
        value = null;
      }
    }
    sandbox.set(key, value);
  }
  return sandbox.get(key) ?? null;
}

async function sandboxCommand(command: (string | number)[]): Promise<unknown> {
  const [op, key, ...rest] = command.map(String);
  switch (op) {
    case "GET":
      return sandboxGet(key);
    case "MGET":
      return Promise.all([key, ...rest].map(sandboxGet));
    case "SET":
      // NX: only if absent (the roster lock). PX is ignored — a preview
      // instance is short-lived and releases its lock with DEL.
      if (rest.includes("NX") && sandbox.get(key) != null) return null;
      sandbox.set(key, rest[0]);
      return "OK";
    case "DEL":
      sandbox.delete(key);
      return 1;
    case "RPUSH": {
      const list = (sandbox.get(key) as string[] | undefined) ?? [];
      sandbox.set(key, [...list, ...rest]);
      return list.length + rest.length;
    }
    case "LTRIM": {
      const list = (sandbox.get(key) as string[] | undefined) ?? [];
      sandbox.set(key, list.slice(Number(rest[0])));
      return "OK";
    }
    case "LRANGE":
      return (sandbox.get(key) as string[] | undefined) ?? [];
    case "SADD": {
      const set = new Set((sandbox.get(key) as string[] | undefined) ?? []);
      rest.forEach((v) => set.add(v));
      sandbox.set(key, [...set]);
      return rest.length;
    }
    case "SREM": {
      const set = new Set((sandbox.get(key) as string[] | undefined) ?? []);
      rest.forEach((v) => set.delete(v));
      sandbox.set(key, [...set]);
      return rest.length;
    }
    case "SMEMBERS":
      return (sandbox.get(key) as string[] | undefined) ?? [];
    default:
      throw new Error(`Preview sandbox does not support ${op}`);
  }
}

/* ------------------------------ Upstash Redis ----------------------------- */

async function redisCommand(command: (string | number)[]): Promise<unknown> {
  if (previewSandbox) return sandboxCommand(command);
  const res = await fetch(REST_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Redis ${command[0]} failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(`Redis error: ${json.error}`);
  return json.result ?? null;
}

/* -------------------------------- File store ------------------------------ */

const FILE = path.join(process.cwd(), ".data", "days.json");

/**
 * On Vercel the filesystem is ephemeral and per-instance, so a file fallback
 * would silently lose ticks. Fail loudly instead — the UI shows "Not saved".
 */
function assertLocal() {
  if (process.env.VERCEL) {
    throw new Error(
      "No shared store configured. Add the Redis integration and redeploy " +
        "(KV_REST_API_URL / KV_REST_API_TOKEN)."
    );
  }
}

async function readFileStore(): Promise<Record<string, DayDoc>> {
  assertLocal();
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeFileStore(all: Record<string, DayDoc>): Promise<void> {
  assertLocal();
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

/* --------------------------------- roster --------------------------------- */
// One key, one document: the whole student list. Small enough to read and write
// whole, and last-write-wins is the right model — two people editing the same
// row at the same second is not a real scenario here.

const ROSTER_KEY = "adit:roster";
const ROSTER_FILE = path.join(process.cwd(), ".data", "roster.json");

export async function getRoster(): Promise<Roster> {
  if (usingRedis) {
    const raw = await redisCommand(["GET", ROSTER_KEY]);
    return parseRoster(raw);
  }
  assertLocal();
  try {
    return parseRoster(await fs.readFile(ROSTER_FILE, "utf8"));
  } catch {
    return EMPTY_ROSTER;
  }
}

export async function putRoster(students: Student[]): Promise<Roster> {
  const saved: Roster = { students, updatedAt: new Date().toISOString() };
  if (usingRedis) {
    await redisCommand(["SET", ROSTER_KEY, JSON.stringify(saved)]);
    return saved;
  }
  assertLocal();
  await fs.mkdir(path.dirname(ROSTER_FILE), { recursive: true });
  await fs.writeFile(ROSTER_FILE, JSON.stringify(saved, null, 2), "utf8");
  return saved;
}

/* ------------------------- safe read-change-write ------------------------- */
// Every server-side roster change goes through updateRoster(). Two guards:
//   1. Saves take turns — an in-process queue, plus a short Redis lock so two
//      server instances can't interleave a read and a write either.
//   2. If the stored roster can't be read, nothing is written. Treating an
//      unreadable roster as empty and saving would wipe every student.

const LOCK_KEY = "adit:roster:lock";
const LOCK_MS = 5_000;
let queue: Promise<unknown> = Promise.resolve();

async function withRedisLock<T>(fn: () => Promise<T>, lockKey = LOCK_KEY): Promise<T> {
  if (!usingRedis) return fn();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_MS;
  while ((await redisCommand(["SET", lockKey, token, "NX", "PX", LOCK_MS])) !== "OK") {
    if (Date.now() > deadline) throw new Error("Roster is busy — try again");
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  }
  try {
    return await fn();
  } finally {
    // Release only our own lock; if it expired and someone else holds it, leave it.
    if ((await redisCommand(["GET", lockKey])) === token) await redisCommand(["DEL", lockKey]);
  }
}

/** The stored roster, or an error — never a silent empty list. */
async function readRosterStrict(): Promise<Student[]> {
  let raw: unknown;
  if (usingRedis) {
    raw = await redisCommand(["GET", ROSTER_KEY]);
  } else {
    assertLocal();
    try {
      raw = await fs.readFile(ROSTER_FILE, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }
  if (!raw) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw; // throws on corrupt data
  if (!parsed || !Array.isArray(parsed.students)) throw new Error("Stored roster is unreadable");
  return cleanRoster(parsed.students);
}

/** Read the stored roster, change it, write it back — server-side and one at a
 *  time. `change` may return null to write nothing (e.g. student not found). */
export async function updateRoster(
  change: (students: Student[]) => Student[] | null
): Promise<Roster> {
  const run = () =>
    withRedisLock(async () => {
      const current = await readRosterStrict();
      const next = change(current);
      if (next === null) return { students: current, updatedAt: null } as Roster;
      return putRoster(next);
    });
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

function parseRoster(raw: unknown): Roster {
  if (!raw) return EMPTY_ROSTER;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      students: cleanRoster(parsed?.students),
      updatedAt: parsed?.updatedAt ?? null,
    };
  } catch {
    return EMPTY_ROSTER;
  }
}

/* -------------------------------- check-ins ------------------------------- */
// One document per day, same shape of problem as the ticks: small, read and
// written whole, last-write-wins.

const CHECKIN_PREFIX = "adit:checkin:";
const CHECKIN_FILE = path.join(process.cwd(), ".data", "checkins.json");

export async function getCheckin(date: DayKey): Promise<CheckinDoc> {
  if (usingRedis) {
    return parseCheckin(await redisCommand(["GET", CHECKIN_PREFIX + date]));
  }
  assertLocal();
  try {
    const all = JSON.parse(await fs.readFile(CHECKIN_FILE, "utf8"));
    return parseCheckin(all[date]);
  } catch {
    return EMPTY_CHECKIN;
  }
}

export async function putCheckin(
  date: DayKey,
  entries: Entries
): Promise<CheckinDoc> {
  const saved: CheckinDoc = { entries, updatedAt: new Date().toISOString() };
  if (usingRedis) {
    await redisCommand([
      "SET",
      CHECKIN_PREFIX + date,
      JSON.stringify(saved),
    ]);
    return saved;
  }
  assertLocal();
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(await fs.readFile(CHECKIN_FILE, "utf8"));
  } catch {
    all = {};
  }
  all[date] = saved;
  await fs.mkdir(path.dirname(CHECKIN_FILE), { recursive: true });
  await fs.writeFile(CHECKIN_FILE, JSON.stringify(all, null, 2), "utf8");
  return saved;
}

/** Every day's check-in in one round trip — the month strip needs all of them. */
export async function getCheckins(
  dates: DayKey[]
): Promise<Record<DayKey, CheckinDoc>> {
  const out: Record<DayKey, CheckinDoc> = {};
  if (!dates.length) return out;

  if (usingRedis) {
    const raw = (await redisCommand([
      "MGET",
      ...dates.map((d) => CHECKIN_PREFIX + d),
    ])) as unknown[] | null;
    dates.forEach((date, i) => {
      const doc = parseCheckin(raw?.[i] ?? null);
      if (doc.updatedAt) out[date] = doc;
    });
    return out;
  }

  assertLocal();
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(await fs.readFile(CHECKIN_FILE, "utf8"));
  } catch {
    return out;
  }
  for (const date of dates) {
    if (all[date]) out[date] = parseCheckin(all[date]);
  }
  return out;
}

function parseCheckin(raw: unknown): CheckinDoc {
  if (!raw) return EMPTY_CHECKIN;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      entries: cleanEntries(parsed?.entries),
      updatedAt: parsed?.updatedAt ?? null,
    };
  } catch {
    return EMPTY_CHECKIN;
  }
}

/* ------------------------------- brain dump ------------------------------- */
// One key, one document: the whole task list, not tied to a day. Read and
// written whole, last-write-wins, same as the roster.

const DUMP_KEY = "adit:dump";
const DUMP_FILE = path.join(process.cwd(), ".data", "dump.json");

export async function getDump(): Promise<DumpDoc> {
  if (usingRedis) {
    return parseDump(await redisCommand(["GET", DUMP_KEY]));
  }
  assertLocal();
  try {
    return parseDump(await fs.readFile(DUMP_FILE, "utf8"));
  } catch {
    return EMPTY_DUMP;
  }
}

export async function putDump(tasks: DumpTask[]): Promise<DumpDoc> {
  const saved: DumpDoc = { tasks, updatedAt: new Date().toISOString() };
  if (usingRedis) {
    await redisCommand(["SET", DUMP_KEY, JSON.stringify(saved)]);
    return saved;
  }
  assertLocal();
  await fs.mkdir(path.dirname(DUMP_FILE), { recursive: true });
  await fs.writeFile(DUMP_FILE, JSON.stringify(saved, null, 2), "utf8");
  return saved;
}

function parseDump(raw: unknown): DumpDoc {
  if (!raw) return EMPTY_DUMP;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      tasks: cleanTasks(parsed?.tasks),
      updatedAt: parsed?.updatedAt ?? null,
    };
  } catch {
    return EMPTY_DUMP;
  }
}

/* ------------------------------- activity log ----------------------------- */
// Append-only. There is deliberately no update or delete path — a clock stamp
// removed by mistake is recorded as a removal, never erased.
//
// Events live in a Redis list, presence in a Redis set of five-minute buckets.
// Both are keyed by the IST calendar date, because these are Adit's shifts.

const LOG_PREFIX = "adit:log:";
const PRESENCE_PREFIX = "adit:presence:";
const MAX_EVENTS = 500;

export async function appendLog(date: string, event: LogEvent): Promise<void> {
  if (!usingRedis) {
    assertLocal();
    return;
  }
  await redisCommand(["RPUSH", LOG_PREFIX + date, JSON.stringify(event)]);
  // Keep the day bounded; a runaway client cannot grow the key without limit.
  await redisCommand(["LTRIM", LOG_PREFIX + date, -MAX_EVENTS, -1]);
}

export async function markPresence(date: string, bucket: number): Promise<void> {
  if (!usingRedis) {
    assertLocal();
    return;
  }
  await redisCommand(["SADD", PRESENCE_PREFIX + date, bucket]);
}

export async function getActivity(
  date: string
): Promise<{ events: LogEvent[]; buckets: number[] }> {
  if (!usingRedis) {
    assertLocal();
    return { events: [], buckets: [] };
  }
  const rawEvents = (await redisCommand([
    "LRANGE",
    LOG_PREFIX + date,
    0,
    -1,
  ])) as unknown[] | null;
  const rawBuckets = (await redisCommand([
    "SMEMBERS",
    PRESENCE_PREFIX + date,
  ])) as unknown[] | null;

  const events = (rawEvents ?? [])
    .map((raw) => {
      try {
        return cleanEvent(typeof raw === "string" ? JSON.parse(raw) : raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as LogEvent[];

  return { events, buckets: cleanBuckets(rawBuckets ?? []) };
}

/* --------------------------------- to-dos --------------------------------- */
// One key, one list. Project work with owners and deadlines — deliberately kept
// out of the daily score, so an open build task never costs Adit his grade.

const TODOS_KEY = "adit:todos";
const TODOS_FILE = path.join(process.cwd(), ".data", "todos.json");

export type TodosDoc = {
  todos: Todo[];
  updatedAt: string | null;
  /** Set once the old Checklist tab's tasks have been folded in. */
  dumpMerged?: boolean;
};

export async function getTodos(): Promise<TodosDoc> {
  if (usingRedis) return parseTodos(await redisCommand(["GET", TODOS_KEY]));
  assertLocal();
  try {
    return parseTodos(await fs.readFile(TODOS_FILE, "utf8"));
  } catch {
    return { todos: [], updatedAt: null };
  }
}

export async function putTodos(todos: Todo[], dumpMerged = false): Promise<TodosDoc> {
  const saved: TodosDoc = { todos, updatedAt: new Date().toISOString(), dumpMerged };
  if (usingRedis) {
    await redisCommand(["SET", TODOS_KEY, JSON.stringify(saved)]);
    return saved;
  }
  assertLocal();
  await fs.mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await fs.writeFile(TODOS_FILE, JSON.stringify(saved, null, 2), "utf8");
  return saved;
}

function parseTodos(raw: unknown): TodosDoc {
  if (!raw) return { todos: [], updatedAt: null };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      todos: cleanTodos(parsed?.todos),
      updatedAt: parsed?.updatedAt ?? null,
      dumpMerged: parsed?.dumpMerged === true,
    };
  } catch {
    return { todos: [], updatedAt: null };
  }
}

/* --------------------------------- corners -------------------------------- */
// One document per person per day — same shape as Today's day doc, so the
// corner reuses the ticks/notes save path. Keyed adit:corner:<person>:<date>.

const CORNER_PREFIX = "adit:corner:";
const CORNER_FILE = path.join(process.cwd(), ".data", "corners.json");

const cornerKey = (person: string, date: DayKey) => `${CORNER_PREFIX}${person}:${date}`;

async function readCornerFile(): Promise<Record<string, DayDoc>> {
  assertLocal();
  try {
    return JSON.parse(await fs.readFile(CORNER_FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function getCornerDay(person: string, date: DayKey): Promise<DayDoc> {
  if (usingRedis) return parseDoc(await redisCommand(["GET", cornerKey(person, date)]));
  const all = await readCornerFile();
  return all[`${person}:${date}`] ?? EMPTY_DAY;
}

export async function putCornerDay(
  person: string,
  date: DayKey,
  doc: Omit<DayDoc, "updatedAt">
): Promise<DayDoc> {
  const saved: DayDoc = { ...doc, updatedAt: new Date().toISOString() };
  if (usingRedis) {
    await redisCommand(["SET", cornerKey(person, date), JSON.stringify(saved)]);
    return saved;
  }
  const all = await readCornerFile();
  all[`${person}:${date}`] = saved;
  await fs.mkdir(path.dirname(CORNER_FILE), { recursive: true });
  await fs.writeFile(CORNER_FILE, JSON.stringify(all, null, 2), "utf8");
  return saved;
}

export async function getCornerDays(
  person: string,
  dates: DayKey[]
): Promise<Record<DayKey, DayDoc>> {
  const out: Record<DayKey, DayDoc> = {};
  if (!dates.length) return out;
  if (usingRedis) {
    const raw = (await redisCommand(["MGET", ...dates.map((d) => cornerKey(person, d))])) as
      | unknown[]
      | null;
    dates.forEach((date, i) => {
      const doc = parseDoc(raw?.[i] ?? null);
      if (doc.updatedAt) out[date] = doc;
    });
    return out;
  }
  const all = await readCornerFile();
  for (const date of dates) {
    const doc = all[`${person}:${date}`];
    if (doc) out[date] = doc;
  }
  return out;
}

/* ------------------------------- Public API ------------------------------- */

export async function getDay(date: DayKey): Promise<DayDoc> {
  if (usingRedis) {
    const raw = await redisCommand(["GET", PREFIX + date]);
    return parseDoc(raw);
  }
  const all = await readFileStore();
  return all[date] ?? EMPTY_DAY;
}

export async function putDay(
  date: DayKey,
  doc: Omit<DayDoc, "updatedAt">
): Promise<DayDoc> {
  const saved: DayDoc = {
    ticks: doc.ticks,
    notes: doc.notes,
    updatedAt: new Date().toISOString(),
  };
  if (usingRedis) {
    await redisCommand(["SET", PREFIX + date, JSON.stringify(saved)]);
    return saved;
  }
  const all = await readFileStore();
  all[date] = saved;
  await writeFileStore(all);
  return saved;
}

export async function getDays(dates: DayKey[]): Promise<Record<DayKey, DayDoc>> {
  const out: Record<DayKey, DayDoc> = {};
  if (!dates.length) return out;

  if (usingRedis) {
    const raw = (await redisCommand(["MGET", ...dates.map((d) => PREFIX + d)])) as
      | unknown[]
      | null;
    dates.forEach((date, i) => {
      const doc = parseDoc(raw?.[i] ?? null);
      if (doc.updatedAt) out[date] = doc;
    });
    return out;
  }

  const all = await readFileStore();
  for (const date of dates) {
    if (all[date]) out[date] = all[date];
  }
  return out;
}

function parseDoc(raw: unknown): DayDoc {
  if (!raw) return EMPTY_DAY;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      ticks: parsed?.ticks ?? {},
      notes: parsed?.notes ?? "",
      updatedAt: parsed?.updatedAt ?? null,
    };
  } catch {
    return EMPTY_DAY;
  }
}

/* ---------------------------------- sales ---------------------------------- */
// One key per meeting (`adit:sales:m:<id>`), a set of ids per IST day
// (`adit:sales:d:<date>`) and a set of every id (`adit:sales:all`). Small keys,
// so months of calls never grow one document past Redis's request limit.
// Every write goes through the sales lock, the same way the roster's do.

const SALES_M = "adit:sales:m:";
const SALES_D = "adit:sales:d:";
const SALES_ALL = "adit:sales:all";
const SALES_SYNC = "adit:sales:sync";
const SALES_LOCK = "adit:sales:lock";
const SALES_FILE = path.join(process.cwd(), ".data", "sales.json");

type SalesFile = { meetings: Record<string, Meeting>; sync: SalesSync | null };
export type SalesSync = { at: string; seen: number; error: string };

let salesQueue: Promise<unknown> = Promise.resolve();

function salesSerial<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => withRedisLock(fn, SALES_LOCK);
  const result = salesQueue.then(run, run);
  salesQueue = result.catch(() => undefined);
  return result;
}

async function readSalesFile(): Promise<SalesFile> {
  assertLocal();
  try {
    return JSON.parse(await fs.readFile(SALES_FILE, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { meetings: {}, sync: null };
    throw err;
  }
}

async function writeSalesFile(f: SalesFile): Promise<void> {
  assertLocal();
  await fs.mkdir(path.dirname(SALES_FILE), { recursive: true });
  await fs.writeFile(SALES_FILE, JSON.stringify(f, null, 2), "utf8");
}

async function getMeetings(ids: string[]): Promise<Meeting[]> {
  if (!ids.length) return [];
  if (!usingRedis) {
    const f = await readSalesFile();
    return ids.map((id) => f.meetings[id]).filter(Boolean).map((m) => cleanMeeting(m)!).filter(Boolean);
  }
  const out: Meeting[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const raws = (await redisCommand(["MGET", ...chunk.map((id) => SALES_M + id)])) as (string | null)[];
    for (const raw of raws ?? []) {
      if (!raw) continue;
      const m = cleanMeeting(typeof raw === "string" ? JSON.parse(raw) : raw);
      if (m) out.push(m);
    }
  }
  return out;
}

async function putMeeting(m: Meeting, previousDate?: string): Promise<void> {
  if (!usingRedis) {
    const f = await readSalesFile();
    f.meetings[m.id] = m;
    await writeSalesFile(f);
    return;
  }
  await redisCommand(["SET", SALES_M + m.id, JSON.stringify(m)]);
  await redisCommand(["SADD", SALES_D + m.date, m.id]);
  await redisCommand(["SADD", SALES_ALL, m.id]);
  if (previousDate && previousDate !== m.date) await redisCommand(["SREM", SALES_D + previousDate, m.id]);
}

const byStart = (a: Meeting, b: Meeting) => a.start.localeCompare(b.start);

/** Every meeting filed under one IST day, earliest first. */
export async function salesDay(date: string): Promise<Meeting[]> {
  if (!usingRedis) {
    const f = await readSalesFile();
    return Object.values(f.meetings).map((m) => cleanMeeting(m)!).filter((m) => m && m.date === date).sort(byStart);
  }
  const ids = ((await redisCommand(["SMEMBERS", SALES_D + date])) as string[]) ?? [];
  return (await getMeetings(ids)).filter((m) => m.date === date).sort(byStart);
}

/** Every meeting ever logged — for search and the numbers. */
export async function salesAll(): Promise<Meeting[]> {
  if (!usingRedis) {
    const f = await readSalesFile();
    return Object.values(f.meetings).map((m) => cleanMeeting(m)!).filter(Boolean).sort(byStart);
  }
  const ids = ((await redisCommand(["SMEMBERS", SALES_ALL])) as string[]) ?? [];
  return (await getMeetings(ids)).sort(byStart);
}

/** Apply a page edit to one meeting. Only the editable fields can change. */
export async function editMeeting(id: string, edit: Edit): Promise<Meeting | null> {
  return salesSerial(async () => {
    const [m] = await getMeetings([id]);
    if (!m) return null;
    const next = { ...m, ...edit, updatedAt: new Date().toISOString() };
    await putMeeting(next);
    return next;
  });
}

/** One call as Claude's nightly sync reports it (Google Calendar + Meet transcript). */
export type ClaudeEntry = {
  eventId?: string;
  start: string;
  name?: string;
  email?: string;
  salesCall?: boolean;
  status?: string;
  summary?: string;
  next?: string;
  transcriptUrl?: string;
  attendees?: string;
};

/** Fold Claude's log in. Matches an existing call (same id, or same start and
 *  guest), else files a new one. Only the log half is written; taps are never touched. */
export async function applyClaudeLog(entries: ClaudeEntry[]): Promise<{ matched: number; added: number }> {
  return salesSerial(async () => {
    const all = await salesAll();
    const at = new Date().toISOString();
    let matched = 0;
    let added = 0;
    for (const e of entries) {
      const t = Date.parse(e.start);
      if (!Number.isFinite(t)) continue;
      const email = (e.email ?? "").trim().toLowerCase();
      const name = (e.name ?? "").trim().toLowerCase();
      const near = (m: Meeting) => Math.abs(Date.parse(m.start) - t) <= 30 * 60_000;
      const sameGuest = (m: Meeting) =>
        (email && [m.email, m.calEmail].some((x) => x.toLowerCase() === email)) ||
        (name && [m.name, m.calName].some((x) => x && (x.toLowerCase().includes(name) || name.includes(x.toLowerCase()))));
      const found =
        (e.eventId && all.find((m) => m.id === e.eventId)) || all.find((m) => near(m) && sameGuest(m)) || null;
      const log = cleanLog({ ...e, at });
      if (found) {
        const next = { ...found, log: { ...log, transcriptUrl: log.transcriptUrl || found.log.transcriptUrl } };
        await putMeeting(next);
        found.log = next.log;
        matched++;
        continue;
      }
      const start = new Date(t).toISOString();
      const m: Meeting = {
        id: (e.eventId || `claude-${start}-${email || name}`).slice(0, 200),
        date: istDate(start),
        start,
        calName: (e.name ?? "").slice(0, 120),
        calEmail: email.slice(0, 160),
        calWhatsapp: "",
        answers: [],
        calCancelled: false,
        calNoShow: false,
        gone: false,
        manual: false,
        name: "",
        email: "",
        whatsapp: "",
        outcome: "",
        tags: [],
        note: "",
        notSales: e.salesCall === false,
        updatedAt: at,
        log: log ?? { ...EMPTY_LOG },
      };
      await putMeeting(m);
      all.push(m);
      added++;
    }
    return { matched, added };
  });
}

/** Add a meeting by hand (someone who booked outside the calendar). */
export async function addManualMeeting(m: Meeting): Promise<Meeting> {
  return salesSerial(async () => {
    await putMeeting(m);
    return m;
  });
}

/** Fold calendar reads in. Creates new meetings, refreshes the calendar half of
 *  known ones, never touches what was tapped. */
export async function syncMeetings(parts: CalendarPart[]): Promise<{ added: number; updated: number }> {
  return salesSerial(async () => {
    // The same booking can arrive under a new id (an import via the API, then the
    // iCal feed). Same start and same guest email = the same call: keep the old id.
    const all = await salesAll();
    const byKey = new Map(all.map((m) => [`${m.start}|${m.calEmail.toLowerCase()}`, m.id]));
    const known = new Set(all.map((m) => m.id));
    parts = parts.map((p) => {
      if (known.has(p.id) || !p.calEmail) return p;
      const same = byKey.get(`${p.start}|${p.calEmail.toLowerCase()}`);
      return same ? { ...p, id: same } : p;
    });
    const existing = new Map((await getMeetings(parts.map((p) => p.id))).map((m) => [m.id, m]));
    let added = 0;
    let updated = 0;
    if (!usingRedis) {
      const f = await readSalesFile();
      for (const p of parts) {
        const before = existing.get(p.id) ?? null;
        f.meetings[p.id] = mergeFromCalendar(before, p);
        if (before) updated++;
        else added++;
      }
      await writeSalesFile(f);
      return { added, updated };
    }
    for (const p of parts) {
      const before = existing.get(p.id) ?? null;
      await putMeeting(mergeFromCalendar(before, p), before?.date);
      if (before) updated++;
      else added++;
    }
    return { added, updated };
  });
}

export async function getSalesSync(): Promise<SalesSync | null> {
  if (!usingRedis) return (await readSalesFile()).sync;
  const raw = await redisCommand(["GET", SALES_SYNC]);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as SalesSync);
  } catch {
    return null;
  }
}

export async function putSalesSync(sync: SalesSync): Promise<void> {
  if (!usingRedis) {
    await salesSerial(async () => {
      const f = await readSalesFile();
      f.sync = sync;
      await writeSalesFile(f);
    });
    return;
  }
  await redisCommand(["SET", SALES_SYNC, JSON.stringify(sync)]);
}
