/**
 * Autosave: the open project is written to IndexedDB (database "pcs-platform", store "projects",
 * key "current") a moment after each change, and read back on startup. IndexedDB holds tens of MB,
 * so embedded images and the MB workbook fit; localStorage (≈5 MB) would not.
 */
import { parseProject, serializeProject } from "../model/project";
import type { Project } from "../model/types";

const DB_NAME = "pcs-platform";
const STORE = "projects";
const KEY = "current";

function openDb(factory: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error("This browser cannot use IndexedDB.")); return; }
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Cannot open IndexedDB."));
    req.onblocked = () => reject(new Error("Another tab is using the storage."));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? req.error);
    t.onabort = () => reject(t.error ?? new Error("Saving was aborted."));
  });
}

export interface StoredProject {
  savedAt: string;
  /** Serialized project (same text as the .pcs.json file). */
  text: string;
  /** updatedAt of the project when it was last written to a file, if ever. */
  fileSavedVersion?: string;
}

export async function saveCurrent(p: Project, fileSavedVersion?: string, factory?: IDBFactory): Promise<string> {
  const db = await openDb(factory);
  try {
    const record: StoredProject = { savedAt: new Date().toISOString(), text: serializeProject(p), fileSavedVersion };
    await tx(db, "readwrite", (s) => s.put(record, KEY));
    return record.savedAt;
  } finally {
    db.close();
  }
}

/**
 * A connection kept open for saving while the page is closing: opening one is asynchronous and
 * would not finish in time, but a write on an open connection can be started synchronously.
 */
let held: IDBDatabase | null = null;

export function holdConnection(factory?: IDBFactory): void {
  if (held) return;
  openDb(factory).then((db) => {
    held = db;
    db.onclose = () => { if (held === db) held = null; };
    db.onversionchange = () => { db.close(); if (held === db) held = null; };
  }, () => { /* autosave reports its own errors */ });
}

/** Starts the write now, without waiting; returns false when no connection is open yet. */
export function saveCurrentNow(p: Project, fileSavedVersion?: string): boolean {
  if (!held) return false;
  try {
    const t = held.transaction(STORE, "readwrite");
    const record: StoredProject = { savedAt: new Date().toISOString(), text: serializeProject(p), fileSavedVersion };
    t.objectStore(STORE).put(record, KEY);
    (t as IDBTransaction & { commit?: () => void }).commit?.();
    return true;
  } catch {
    return false;
  }
}

export async function loadCurrent(factory?: IDBFactory): Promise<{ project: Project; notes: string[]; savedAt: string; fileSavedVersion?: string } | null> {
  const db = await openDb(factory);
  try {
    const rec = (await tx(db, "readonly", (s) => s.get(KEY))) as StoredProject | undefined;
    if (!rec || typeof rec.text !== "string") return null;
    const { project, notes } = parseProject(rec.text);
    return { project, notes, savedAt: rec.savedAt, fileSavedVersion: rec.fileSavedVersion };
  } finally {
    db.close();
  }
}

export async function clearCurrent(factory?: IDBFactory): Promise<void> {
  const db = await openDb(factory);
  try {
    await tx(db, "readwrite", (s) => s.delete(KEY));
  } finally {
    db.close();
  }
}

/** Calls `write` at most once per `delayMs` after the last `schedule`; `flush` writes now. */
export function debouncer(write: () => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; write(); }, delayMs);
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; write(); }
    },
    pending: () => timer !== null,
  };
}
