// Browser test of N5.6.1 (merged cells in the MB workbook): the small example's workbook with its StreamIDs
// merged down applies exactly like the plain one; a title row above the PCS_LINK headers is read (Headers in
// row 2); a merged quantity is an error that keeps Apply off and names the block.
// Usage: LANG=C.UTF-8 node tools/smoke-mb-merged.mjs <base-url>
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const ExcelJS = require("exceljs");

const [base] = process.argv.slice(2);
const ex = (f) => resolve("examples", f);
const dir = mkdtempSync(join(tmpdir(), "pcs-merged-"));
/** MB_example.xlsx changed by `edit` on its PCS_LINK sheet, saved as `name`. */
async function variant(name, edit) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ex("MB_example.xlsx"));
  edit(wb.getWorksheet("PCS_LINK"));
  const file = join(dir, name);
  await wb.xlsx.writeFile(file);
  return file;
}
// PCS_LINK rows: 2–3 ST-10L-001 (flow, MAT-0001), 4 ST-10L-100L, 5–6 ST-100L-001, 7–8 ST-100L-002.
const merged = await variant("MB_merged_ids.xlsx", (ws) => {
  for (const [a, b] of [["A2", "A3"], ["A5", "A6"], ["A7", "A8"]]) { ws.getCell(b).value = null; ws.mergeCells(`${a}:${b}`); }
});
const titled = await variant("MB_title_row.xlsx", (ws) => {
  ws.spliceRows(1, 0, ["PCS_LINK · values from MB_calc"]);
  ws.mergeCells("A1:F1");
});
const qty = await variant("MB_merged_qty.xlsx", (ws) => { ws.mergeCells("D7:D8"); });

const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/^\[eframe|wgpu/.test(m.text())) errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const text = (sel) => page.locator(sel).innerText();
const chooseFile = async (button, file, confirmLabel) => {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: button }).click()]);
  await chooser.setFiles(file);
  if (confirmLabel) await page.getByRole("button", { name: confirmLabel, exact: true }).click();
  await wait(1200);
};
const labels = () => page.evaluate(() => {
  const all = window.__pcsPfd.all();
  return Object.fromEntries(all.filter((e) => e.type === "text" && e.customData?.pcs?.label)
    .map((e) => [all.find((a) => a.id === e.containerId)?.customData?.pcs?.streamId, e.originalText ?? e.text]));
});
const head = () => text("section[aria-label='Check'] .section-head").then((s) => s.replace(/\n/g, " | "));

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForFunction(() => window.__pcsPfd);
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const discard = page.getByRole("button", { name: "Open without saving" });
    if (await discard.isVisible({ timeout: 1500 }).catch(() => false)) await discard.click();
  })()]);
  await chooser.setFiles(ex("example-process.pcs.json"));
  await page.waitForFunction(() => window.__pcsPfd?.all().some((e) => e.customData?.pcs?.streamId === "ST-10L-100L"));
  await wait(1000);
}
await page.getByRole("tab", { name: "Mass Balance" }).click();
await wait(800);

// StreamIDs merged down: read on every row, applied like the plain workbook.
await chooseFile("Upload Excel workbook…", merged);
let h = await head();
check("StreamIDs merged down: 0 errors, 0 warnings, 4 flow + 3 material rows", /0 errors/.test(h) && /0 warnings/.test(h) && /4 flow rows · 3 material rows/.test(h), h);
await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
await wait(900);
const l = await labels();
check("applied: the PFD labels carry the values (ST-100L-001 85 / 425 L, ST-100L-002 5 / 25 L)", /S 85 · R 425 L/.test(l["ST-100L-001"] ?? "") && /S 5 · R 25 L/.test(l["ST-100L-002"] ?? ""), JSON.stringify(l));
await page.getByRole("tab", { name: "BOM" }).click();
await wait(700);
const bom = await page.locator("tr[data-bom-line='100L|MAT-0002']").innerText().catch(() => "");
check("BOM: the merged StreamID's material row counts (MAT-0002 in 100L: 0.62 / 3.1 kg)", /0\.62/.test(bom) && /3\.1/.test(bom), bom.replace(/\s+/g, " ").slice(0, 160));
await page.getByRole("tab", { name: "Mass Balance" }).click();
await wait(700);

// A title row above the headers.
await chooseFile("Replace…", titled, "Replace");
h = await head();
check("title row: headers found in row 2, 0 errors, the same 7 rows", /Headers in row 2/.test(h) && /0 errors/.test(h) && /4 flow rows · 3 material rows/.test(h), h);

// A merged quantity.
await chooseFile("Replace…", qty, "Replace");
h = await head();
const issues = await text("section[aria-label='Check'] .mb-check");
check("merged quantity: an error naming D7:D8, Apply stays off", /1 error/.test(h) && /Sending cells D7:D8 are merged/.test(issues) && await page.getByRole("button", { name: "Apply to PFD and BOM" }).isDisabled(), h);
check("the applied values stay those of the merged-StreamID workbook", /S 85 · R 425 L/.test((await labels())["ST-100L-001"] ?? ""));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
