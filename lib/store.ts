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

async function withRedisLock<T>(fn: () => Promise<T>): Promise<T> {
  if (!usingRedis) return fn();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_MS;
  while ((await redisCommand(["SET", LOCK_KEY, token, "NX", "PX", LOCK_MS])) !== "OK") {
    if (Date.now() > deadline) throw new Error("Roster is busy — try again");
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  }
  try {
    return await fn();
  } finally {
    // Release only our own lock; if it expired and someone else holds it, leave it.
    if ((await redisCommand(["GET", LOCK_KEY])) === token) await redisCommand(["DEL", LOCK_KEY]);
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
