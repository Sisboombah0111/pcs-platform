import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createProject } from "../src/model/project";
import { sampleMaterials } from "../src/model/sampleData";
import { clearCurrent, debouncer, loadCurrent, saveCurrent } from "../src/storage/autosave";

describe("autosave (IndexedDB)", () => {
  it("save, load, clear", async () => {
    const idb = new IDBFactory();
    expect(await loadCurrent(idb)).toBeNull();
    const p = createProject("Autosave test");
    p.materials = sampleMaterials();
    await saveCurrent(p, p.meta.updatedAt, idb);
    const back = await loadCurrent(idb);
    expect(back?.project).toEqual(p);
    expect(back?.fileSavedVersion).toBe(p.meta.updatedAt);
    await clearCurrent(idb);
    expect(await loadCurrent(idb)).toBeNull();
  });

  it("debouncer writes once after the last call", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const d = debouncer(write, 500);
    d.schedule(); d.schedule(); d.schedule();
    vi.advanceTimersByTime(499);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    d.schedule(); d.flush();
    expect(write).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
