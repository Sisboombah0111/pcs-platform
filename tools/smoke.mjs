// Browser smoke test of the built app: autosave survives reload, file save/open round trip,
// materials screen, PFD board, no failed requests.
// Usage: LANG=C.UTF-8 node tools/smoke.mjs <base-url> [screenshot-prefix]
// (Headless Chromium needs a UTF-8 locale to keep non-ASCII download names.)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Playwright comes from the project (devDependency) or the machine's global install.
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const { chromium } = playwright;

const [base, shot] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
// The in-app guide opens on a first visit; these checks run with it closed (tools/smoke-guide.mjs tests it).
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
const failed = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("requestfailed", (r) => failed.push(r.url()));
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };

await page.goto(base);
await page.waitForSelector(".excalidraw", { timeout: 20000 });
check("PFD board opens", await page.locator(".excalidraw canvas").count() > 0);

// An empty project shows the start card (N5.1) over the middle of the process map: close it to draw there.
const startClose = page.getByRole("button", { name: "Hide the start card" });
if (await startClose.isVisible().catch(() => false)) await startClose.click();

// Draw a rectangle with the keyboard shortcut and a drag.
const canvas = page.locator("canvas.interactive");
await canvas.click({ position: { x: 700, y: 400 } });
await page.keyboard.press("r");
await page.mouse.move(600, 350);
await page.mouse.down();
await page.mouse.move(760, 460, { steps: 6 });
await page.mouse.up();
await page.keyboard.press("Escape");
await page.waitForTimeout(1200);
check("autosave status shown", /Autosaved/.test(await page.textContent(".bar")), (await page.textContent(".status .label")) ?? "");

// Materials: sample list.
await page.getByRole("tab", { name: /Materials/ }).click();
await page.getByRole("button", { name: "Add 33 sample materials" }).click();
check("33 sample materials", (await page.locator("table.grid tbody tr").count()) === 33);
await page.locator('input[aria-label="Name"]').first().fill("Basal Medium (분말)");
await page.waitForTimeout(1200);
if (shot) await page.screenshot({ path: `${shot}-materials.png` });

// Reload: everything comes back from IndexedDB.
await page.reload();
await page.waitForSelector(".excalidraw");
const stored = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("pcs-platform", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rec = await new Promise((res) => { const t = db.transaction("projects").objectStore("projects").get("current"); t.onsuccess = () => res(t.result); });
  const p = JSON.parse(rec.text);
  return { elements: p.pfd.map.elements.length, materials: p.materials.length, first: p.materials[0].name };
});
check("PFD shape kept after reload", stored.elements === 1, JSON.stringify(stored));
check("material edit kept after reload", stored.materials === 33 && stored.first === "Basal Medium (분말)");

// Save to file, start a new project, open the file again.
check("unsaved changes: a dot on Save to file", (await page.locator(".unsaved-dot").count()) === 1);
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
const path = await download.path();
const saved = JSON.parse(readFileSync(path, "utf8"));
check("save to file", saved.format === "pcs-project" && saved.materials.length === 33 && saved.pfd.map.elements.length === 1 && download.suggestedFilename() === "New process.pcs.json", download.suggestedFilename());
check("the unsaved dot clears after saving", (await page.locator(".unsaved-dot").count()) === 0);

await page.getByRole("button", { name: "New", exact: true }).click();
await page.getByRole("checkbox", { name: /sample materials/ }).uncheck();
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByRole("tab", { name: /Materials/ }).click();
check("new project is empty", await page.getByText("No materials yet").isVisible());

// The new project now has changes not saved to a file, so opening asks first.
await page.locator(".project-name").fill("Scratch");
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: /without saving/ }).click();
  })(),
]);
await chooser.setFiles(path);
await page.waitForTimeout(500);
await page.getByRole("tab", { name: /Materials/ }).click();
check("open file", (await page.locator("table.grid tbody tr").count()) === 33 && (await page.inputValue(".project-name")) === "New process");

await page.getByRole("tab", { name: "PFD" }).click();
await page.waitForTimeout(1500);
check("not flagged unsaved right after opening", (await page.locator(".unsaved-dot").count()) === 0);
if (shot) await page.screenshot({ path: `${shot}-pfd.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
check("no failed requests (no CDN calls)", failed.length === 0, failed.slice(0, 5).join(" | "));
await browser.close();
console.log(log.join("\n"));
