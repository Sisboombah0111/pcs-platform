import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_PROJECTS, isUntouchedExample } from "../src/examples";

// The app starts empty instead of restoring an example autosaved as it came (N5.5): that needs each example's id
// and last change as they are in its file. Regenerating an example changes them: update src/examples.ts too.
describe("example projects", () => {
  for (const ex of EXAMPLE_PROJECTS) {
    it(`${ex.file}: id and updatedAt match the file`, () => {
      const file = JSON.parse(readFileSync(resolve(__dirname, "../examples", ex.file), "utf8"));
      expect(ex.projectId).toBe(file.id);
      expect(ex.updatedAt).toBe(file.meta.updatedAt);
      expect(isUntouchedExample(file)).toBe(true);
    });
  }
  it("an example changed after it was opened is the user's project", () => {
    const ex = EXAMPLE_PROJECTS[0];
    expect(isUntouchedExample({ id: ex.projectId!, meta: { updatedAt: "2026-11-09T06:00:00.000Z" } })).toBe(false);
    expect(isUntouchedExample({ id: "prj_mine", meta: { updatedAt: ex.updatedAt! } })).toBe(false);
  });
});
