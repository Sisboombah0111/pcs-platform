// Browser test of N4.13: undo and redo outside the drawing (typing merged into one step, Operations, Replace,
// Ctrl+Z off the PFD, an undo refused after the same data changed from the PFD) and the change log (who, what,
// saved with the project, Excel export).
// Usage: LANG=C.UTF-8 node tools/smoke-history.mjs <base-url>
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const ExcelJS = require("exceljs");

const [base] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); localStorage.removeItem("pcs.userName"); for (const k of Object.keys(localStorage)) if (k.startsWith("pcs.ops.")) localStorage.removeItem(k); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const text = (sel) => page.locator(sel).first().innerText();
const toast = async () => (await page.locator(".toast").last().innerText().catch(() => ""));
const tab = async (name) => { await page.getByRole("tab", { name: name === "Materials" ? /^Materials/ : name, exact: name !== "Materials" }).click(); await wait(500); };
const undoBtn = () => page.getByRole("button", { name: "Undo change", exact: true });
const redoBtn = () => page.getByRole("button", { name: "Redo change", exact: true });
const nameOf = (code) => page.locator(`tr[data-code='${code}']`).getByLabel("Name").inputValue();

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForSelector(".excalidraw");
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(resolve("examples/example-downstream.pcs.json"));
  await wait(2000);
}
check("a project just opened has nothing to undo", await undoBtn().isDisabled() && await redoBtn().isDisabled());

// Your name, written with the changes.
await page.getByRole("button", { name: "Changes", exact: true }).click();
await page.getByLabel("Your name").fill("Tester");
await page.getByRole("button", { name: "Close", exact: true }).click();

// ---- typing is one step ---------------------------------------------------------------------------------------------------
await tab("Materials");
const before = await nameOf("FLT-0001");
const field = page.locator("tr[data-code='FLT-0001']").getByLabel("Name");
await field.click();
await field.press("End");
await field.pressSequentially(" (old)", { delay: 40 });
await page.getByLabel("Search materials").click();
await wait(300);
check("typed name; Undo says Materials", (await nameOf("FLT-0001")) === `${before} (old)` && /^Undo: Materials/.test(await undoBtn().getAttribute("title")));
await undoBtn().click();
await wait(300);
check("one undo takes back the whole typed name", (await nameOf("FLT-0001")) === before && /Undone: Materials/.test(await toast()), await nameOf("FLT-0001"));
await redoBtn().click();
await wait(300);
check("redo puts it back", (await nameOf("FLT-0001")) === `${before} (old)`);
await undoBtn().click();
await wait(300);

// ---- Operations, and Ctrl+Z on a screen other than the PFD --------------------------------------------------------------------
await tab("Operations");
await page.locator(".ops-nav-item", { hasText: "CEX" }).click();
await page.getByLabel("Add steps from a template").selectOption("bindelute");
await wait(400);
check("CEX has 9 steps", /9 steps/.test(await text(".xl-info")));
await page.locator(".page-head h1").click();
await page.keyboard.press("Control+z");
await wait(400);
check("Ctrl+Z (not in a text field): CEX has no steps again", /0 steps/.test(await text(".xl-info")), await text(".xl-info"));
await page.keyboard.press("Control+y");
await wait(400);
check("Ctrl+Y: the 9 steps are back", /9 steps/.test(await text(".xl-info")));

// ---- Replace, undone ---------------------------------------------------------------------------------------------------------
await tab("Materials");
await page.getByRole("button", { name: "More for FLT-0002" }).click();
await page.getByRole("menuitem", { name: "Replace FLT-0002" }).click();
await page.getByLabel("Replace with").selectOption({ label: 'FLT-0006 · Bulk fill filter 0.2 µm (5") (EA)' });
await page.getByRole("button", { name: "Replace with FLT-0006" }).click();
await wait(1500);
check("replaced: FLT-0002 obsolete", (await page.getByLabel("Status of FLT-0002").inputValue()) === "obsolete" && /^Undo: Replace FLT-0002 with FLT-0006/.test(await undoBtn().getAttribute("title")));
await undoBtn().click();
await wait(800);
check("undo the replacement: FLT-0002 in use again, the toast says what stays", (await page.getByLabel("Status of FLT-0002").inputValue()) === "active" && /PFD links stay on the new material/.test(await toast()), await toast());

// ---- an undo refused: the same data changed from the PFD since --------------------------------------------------------------------
await tab("Operations");
await page.locator(".ops-nav-item", { hasText: "Equipment" }).click();
await page.getByLabel("Note of XV-101").fill("checked");
await page.locator(".page-head h1").click();
await wait(300);
await tab("PFD");
await page.locator(".sheet-tab", { hasText: /^\s*PROA\b/ }).first().click();
await wait(1000);
await page.evaluate(() => {
  const api = window.__pcsPfd.api;
  const els = api.getSceneElements();
  const body = els.find((e) => e.customData?.pcs?.symbol === "bag");
  const g = body.groupIds[0];
  api.updateScene({ appState: { selectedElementIds: Object.fromEntries(els.filter((e) => e.groupIds?.includes(g)).map((m) => [m.id, true])), selectedGroupIds: { [g]: true } } });
});
await wait(400);
await page.getByLabel("Equipment tag").fill("BAG-9");
await page.getByLabel("Equipment tag").press("Enter");
await wait(500);
await tab("Operations");
await undoBtn().click();
await wait(400);
check("undo refused when the equipment list changed on the PFD since", /cannot be undone: the same data changed since/.test(await toast()) && (await page.getByLabel("Note of XV-101").inputValue()) === "checked", await toast());

// ---- the change log --------------------------------------------------------------------------------------------------------------
await page.getByRole("button", { name: "Changes", exact: true }).click();
await wait(300);
const log = (await text(".changes-table")).replace(/\n/g, " | ");
check("change log: who and what, undo and redo lines", /Tester/.test(log) && /Material FLT-0001: name “[^”]+” → “[^”]+ \(old\)”/.test(log) && /Undo: Materials/.test(log) && /Steps of CEX: 0 → 9/.test(log) && /Replace FLT-0002 with FLT-0006/.test(log) && /Equipment changed: XV-101/.test(log) && /PFD\s+\|\s+Equipment added: BAG-9/.test(log), log.slice(0, 300));
const [dlx] = await Promise.all([page.waitForEvent("download"), page.locator(".dialog").getByRole("button", { name: "Export to Excel" }).click()]);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(await dlx.path());
const ws = wb.getWorksheet("Changes");
check("change log exported to Excel", ws && ws.rowCount > 6 && ws.getRow(1).values.slice(1).join() === "When,By,Where / what,Change", `${ws?.rowCount} rows`);
await page.getByRole("button", { name: "Close", exact: true }).click();
const [dlp] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
const saved = JSON.parse(readFileSync(await dlp.path(), "utf8"));
check("the log is saved with the project", saved.changeLog.length >= 6 && saved.changeLog.every((l) => l.by === "Tester"), `${saved.changeLog.length} lines`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
