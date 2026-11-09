// Browser test of N4.7 with the downstream example: the PFD side panel is resized by dragging (and
// remembered), table columns on BOM, Mass Balance and Materials are resized by dragging their header edge
// (the same widths in every BOM unit section, remembered, double-click resets), and the PFD is exported to
// PowerPoint as editable shapes (with stream tables) and as pictures.
// Usage: LANG=C.UTF-8 node tools/smoke-layout.mjs <base-url> [output-prefix for the decks and screenshots]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const JSZip = require("jszip");

const [base, out] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })).newPage();
// The in-app guide opens on a first visit; these checks run with it closed (tools/smoke-guide.mjs tests it).
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const tab = async (name) => { await page.getByRole("tab", { name, exact: true }).click(); await wait(700); };
const dragBy = async (locator, dx) => {
  const b = await locator.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
  await wait(300);
};
const width = (sel) => page.locator(sel).first().evaluate((e) => Math.round(e.getBoundingClientRect().width));
const deck = async (buf) => {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return { slides, xml: await Promise.all(slides.map((n) => zip.file(n).async("string"))) };
};

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForFunction(() => window.__pcsPfd?.api);
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(resolve("examples/example-downstream.pcs.json"));
  await wait(1800);
}

// ---- 1. PFD side panel --------------------------------------------------------------------------------------
const w0 = await width(".pfd-panel");
const cols0 = await page.locator(".symbol-grid").first().evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(" ").length);
await dragBy(page.locator(".pfd-resizer"), -240);
const w1 = await width(".pfd-panel");
const cols1 = await page.locator(".symbol-grid").first().evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(" ").length);
check("dragging the panel edge to the left widens the side panel", w0 === 340 && w1 >= 570 && w1 <= 585, `${w0} → ${w1}`);
check("the symbol palette uses the room (more columns)", cols1 > cols0, `${cols0} → ${cols1}`);
const canvas = await width(".pfd-canvas .excalidraw");
check("the drawing area gets narrower with it", canvas < 1500 - w1 + 10, String(canvas));
if (out) await page.screenshot({ path: `${out}-panel.png` });
await page.reload();
await page.waitForFunction(() => window.__pcsPfd?.api);
await wait(1200);
check("the panel width is remembered after a reload", Math.abs((await width(".pfd-panel")) - w1) <= 2, String(await width(".pfd-panel")));
await page.locator(".pfd-resizer").focus();
await page.keyboard.press("ArrowRight");
await wait(200);
check("arrow keys resize it too", Math.abs((await width(".pfd-panel")) - (w1 - 20)) <= 2, String(await width(".pfd-panel")));
await page.locator(".pfd-resizer").dblclick();
await wait(300);
check("double-click: back to 340 px", (await width(".pfd-panel")) === 340);

// ---- 2. PowerPoint export ----------------------------------------------------------------------------------------
await page.getByRole("button", { name: "Export to PowerPoint…" }).click();
await wait(300);
check("the export dialog lists the map and the 7 unit operations", (await page.locator(".export-list li").count()) === 8 && /Export 16 slides/.test(await page.locator(".dialog").innerText()));
if (out) await page.screenshot({ path: `${out}-export-dialog.png` });
let [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export 16 slides" }).click()]);
let d = await deck(readFileSync(await dl.path()));
if (out) copyFileSync(await dl.path(), `${out}-shapes.pptx`);
check("editable shapes: 16 slides (8 drawings + 8 stream tables), file named after the project", d.slides.length === 16 && dl.suggestedFilename() === "Downstream example (mAb, 15,000 L) PFD.pptx", `${d.slides.length} ${dl.suggestedFilename()}`);
check("the PROA slide has free-form paths with arrowheads, the labels and no picture", /<a:custGeom>/.test(d.xml[2]) && /tailEnd type=/.test(d.xml[2]) && /ST-PROA-007/.test(d.xml[2]) && !/<p:pic>/.test(d.xml[2]));
check("its stream table has the applied values", /<a:tbl>/.test(d.xml[3]) && /14,250/.test(d.xml[3]) && /2,824.8/.test(d.xml[3]));
await wait(600);
await page.getByRole("button", { name: "Export to PowerPoint…" }).click();
await wait(300);
await page.getByRole("button", { name: "None", exact: true }).click();
await page.locator(".export-list label", { hasText: "Process map" }).click();
await page.locator(".export-list label", { hasText: "PROA" }).click();
await page.getByLabel(/^Pictures/).check();
await page.getByLabel(/A stream table after each drawing/).uncheck();
[dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export 2 slides" }).click()]);
d = await deck(readFileSync(await dl.path()));
if (out) copyFileSync(await dl.path(), `${out}-pictures.pptx`);
check("pictures: the 2 chosen slides, each one picture", d.slides.length === 2 && d.xml.every((x) => (x.match(/<p:pic>/g) ?? []).length === 1) && /Process map/.test(d.xml[0]) && /PROA/.test(d.xml[1]));

// ---- 3. table columns ----------------------------------------------------------------------------------------------
await tab("BOM");
const matTh = (uo) => page.locator(`section[aria-label='BOM ${uo}'] thead th`).nth(1);
const before = await matTh("PROA").evaluate((e) => Math.round(e.getBoundingClientRect().width));
const codeBefore = await page.locator("section[aria-label='BOM PROA'] thead th").first().evaluate((e) => Math.round(e.getBoundingClientRect().width));
await matTh("PROA").hover();
await dragBy(matTh("PROA").locator(".col-resizer"), 160);
const after = await matTh("PROA").evaluate((e) => Math.round(e.getBoundingClientRect().width));
const other = await matTh("UFDF").evaluate((e) => Math.round(e.getBoundingClientRect().width));
check("BOM: dragging the Material header edge widens the column", after >= before + 150, `${before} → ${after}`);
check("…in every unit operation's table at once", Math.abs(other - after) <= 1, `PROA ${after}, UFDF ${other}`);
const codeW = await page.locator("section[aria-label='BOM PROA'] thead th").first().evaluate((e) => Math.round(e.getBoundingClientRect().width));
check("the other columns keep their width", Math.abs(codeW - codeBefore) <= 2, `Code ${codeBefore} → ${codeW}`);
if (out) await page.screenshot({ path: `${out}-bom-columns.png` });
await page.reload();
await page.waitForSelector(".excalidraw");
await tab("BOM");
check("column widths are remembered after a reload", Math.abs((await matTh("PROA").evaluate((e) => Math.round(e.getBoundingClientRect().width))) - after) <= 1);
await matTh("PROA").locator(".col-resizer").dblclick();
await wait(300);
check("double-click a header edge: automatic widths again", !/table-layout/.test((await page.locator("section[aria-label='BOM PROA'] table").getAttribute("style")) ?? ""));
const tot = page.locator("section[aria-label='Totals'] thead th").nth(1);
const t0 = await tot.evaluate((e) => Math.round(e.getBoundingClientRect().width));
await tot.scrollIntoViewIfNeeded();
await dragBy(tot.locator(".col-resizer"), -80);
check("BOM totals: a column can be made narrower", (await tot.evaluate((e) => Math.round(e.getBoundingClientRect().width))) <= t0 - 70);

await tab("Mass Balance");
// N5.2: the Mass Balance values are sheets with tabs at the bottom
await page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: /^Material totals/ }).click();
const mbTh = page.locator("table.grid thead th", { hasText: /^Material$/ }).first();
await mbTh.scrollIntoViewIfNeeded();
const m0 = await mbTh.evaluate((e) => Math.round(e.getBoundingClientRect().width));
await dragBy(mbTh.locator(".col-resizer"), 120);
check("Mass Balance material totals: resizable", (await mbTh.evaluate((e) => Math.round(e.getBoundingClientRect().width))) >= m0 + 110);
await page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: /^Streams/ }).click();
const sv = page.locator("table.grid thead th", { hasText: /^Route$/ }).first();
const s0 = await sv.evaluate((e) => Math.round(e.getBoundingClientRect().width));
await sv.scrollIntoViewIfNeeded();
await dragBy(sv.locator(".col-resizer"), 90);
check("Mass Balance stream values: resizable", (await sv.evaluate((e) => Math.round(e.getBoundingClientRect().width))) >= s0 + 80);

await page.getByRole("tab", { name: /^Materials/ }).click();
await wait(500);
const name = page.locator("table.grid thead th", { hasText: /^Name$/ }).first();
const n0 = await name.evaluate((e) => Math.round(e.getBoundingClientRect().width));
await dragBy(name.locator(".col-resizer"), 100);
check("Materials: resizable", (await name.evaluate((e) => Math.round(e.getBoundingClientRect().width))) >= n0 + 90);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
