// Browser test of the Mass Balance screen with the example files: PCS_LINK sheet download,
// upload + check + apply, values on PFD labels / stream table / BOM, change preview, errors block
// the apply, GridCraft round trip (needs public/gridcraft: npm run gridcraft), reload, project file.
// Usage: LANG=C.UTF-8 node tools/smoke-mb.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const ExcelJS = require("exceljs");

const [base, shot] = process.argv.slice(2);
const ex = (f) => resolve("examples", f);
const browser = await playwright.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })).newPage();
// The in-app guide opens on a first visit; these checks run with it closed (tools/smoke-guide.mjs tests it).
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
/** Stream ID → label text, over every PFD drawing (the process map and each UO drawing). */
const labels = () => page.evaluate(() => {
  const all = window.__pcsPfd.all();
  return Object.fromEntries(all.filter((e) => e.type === "text" && e.customData?.pcs?.label)
    .map((e) => [all.find((a) => a.id === e.containerId)?.customData?.pcs?.streamId, e.originalText ?? e.text]));
});

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForFunction(() => window.__pcsPfd);

// Open the example project.
{
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    (async () => {
      await page.getByRole("button", { name: "Open", exact: true }).click();
      const discard = page.getByRole("button", { name: "Open without saving" });
      if (await discard.isVisible({ timeout: 1500 }).catch(() => false)) await discard.click();
    })(),
  ]);
  await chooser.setFiles(ex("example-process.pcs.json"));
  await page.waitForFunction(() => window.__pcsPfd?.all().some((e) => e.customData?.pcs?.streamId === "ST-10L-100L"));
  await wait(1000);
}

await page.getByRole("tab", { name: "Mass Balance" }).click();
await wait(500);
check("empty state offers upload, GridCraft and the PCS_LINK sheet", await page.getByRole("button", { name: "Upload Excel workbook…" }).isVisible() &&
  await page.getByRole("button", { name: "New workbook in GridCraft" }).isEnabled());

// PCS_LINK sheet with the PFD's streams.
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PCS_LINK sheet" }).click()]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await dl.path());
  const ws = wb.getWorksheet("PCS_LINK");
  const ids = [];
  ws.eachRow((r, i) => { if (i > 1) ids.push(r.getCell(1).value); });
  check("PCS_LINK sheet lists the 4 PFD streams", JSON.stringify(ids) === JSON.stringify(["ST-10L-001", "ST-10L-100L", "ST-100L-001", "ST-100L-002"]) &&
    ws.getRow(1).values.slice(1).join(",") === "StreamID,MatCode,Unit,Sending,Receiving,Note", `${dl.suggestedFilename()} ${ids.join(",")}`);
}

// A new workbook typed in GridCraft inside the app: an MB sheet and PCS_LINK with the Stream IDs.
if (await page.getByRole("button", { name: "New workbook in GridCraft" }).isEnabled()) {
  await page.getByRole("button", { name: "New workbook in GridCraft" }).click();
  await page.frameLocator(".gc-frame").locator("canvas").first().waitFor({ timeout: 60000 });
  await wait(6000);
  const box = await page.locator(".gc-frame").boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => /Saved to project/.test(document.querySelector(".gc-bar")?.textContent ?? ""), null, { timeout: 20000 });
  await wait(800);
  if (shot) await page.screenshot({ path: `${shot}-gridcraft-new.png` });
  await page.getByRole("button", { name: "Done" }).click();
  await wait(800);
  const sheets = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open("pcs-platform", 1); r.onsuccess = () => res(r.result); });
    const rec = await new Promise((res) => { const t = db.transaction("projects").objectStore("projects").get("current"); t.onsuccess = () => res(t.result); });
    return JSON.parse(rec.text).mb.workbook?.dataBase64 ?? "";
  });
  const wbNew = new ExcelJS.Workbook();
  await wbNew.xlsx.load(Buffer.from(sheets, "base64"));
  const link = wbNew.getWorksheet("PCS_LINK");
  check("New workbook in GridCraft: saved with an MB sheet and PCS_LINK listing the streams", !!wbNew.getWorksheet("MB") && link?.getCell("A2").value === "ST-10L-001" && /Saved in GridCraft/.test(await text(".mb-card")),
    wbNew.worksheets.map((w) => w.name).join(","));
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).last().click();
  await wait(800);
}

// Upload, check, apply.
await chooseFile("Upload Excel workbook…", ex("MB_example.xlsx"));
let head = await text("section[aria-label='Check'] .section-head");
check("upload: 0 errors, 0 warnings, 4 flow + 3 material rows", /0 errors/.test(head) && /0 warnings/.test(head) && /4 flow rows · 3 material rows/.test(head), head.replace(/\n/g, " | "));
check("file card: GridCraft saved it, never applied", /MB_example\.xlsx/.test(await text(".mb-card")) && /GridCraft/.test(await text(".mb-card")) && /Never applied/.test(await text(".mb-card")));
check("preview: 7 values to apply", /7 changes/.test(await text(".mb-diff")));
await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
await wait(800);
check("applied: button says Applied, history has 1 row", await page.getByRole("button", { name: "Applied" }).isDisabled() &&
  (await page.locator("section[aria-label='History'] tbody tr").count()) === 1);
const applied = await text("section[aria-label='Applied values']");
check("applied values: streams and materials per UO", /ST-100L-001[\s\S]*85[\s\S]*425/.test(applied) && /10L\s+MAT-0001[\s\S]*0\.1575/.test(applied) && /100L\s+MAT-0002[\s\S]*0\.62/.test(applied));
if (shot) await page.screenshot({ path: `${shot}-mb-applied.png`, fullPage: true });

// PFD: labels and stream table.
await page.getByRole("tab", { name: "PFD", exact: true }).click();
await wait(1200);
let lab = await labels();
check("PFD labels show the values", lab["ST-100L-001"] === "ST-100L-001\nBasal medium\nS 85 · R 425 L" && lab["ST-10L-100L"] === "ST-10L-100L\nInoculum transfer\nS 10 · R 50 L", JSON.stringify(lab));
const table = await page.evaluate(() => window.__pcsPfd.api.getSceneElements().find((e) => e.customData?.pcs?.table?.kind === "stream")?.customData.pcs.table.rows);
check("stream table adds Unit, Sending, Receiving", table && table[0].join("|") === "Stream ID|From|To|Name|Unit|Sending|Receiving" && table.some((r) => r.join("|") === "ST-100L-002|100L||Feed A|L|5|25"), JSON.stringify(table?.[0]));
await page.locator(".sheet-tab", { hasText: "100L 100L" }).click();
await wait(1200);
await page.evaluate(() => {
  const api = window.__pcsPfd.api;
  const a = api.getSceneElements().find((e) => e.customData?.pcs?.streamId === "ST-100L-001");
  api.updateScene({ appState: { selectedElementIds: { [a.id]: true } } });
});
await wait(400);
const insp = await text(".inspector");
check("arrow panel shows its MB rows", /Mass balance/.test(insp) && /Flow\s+Sending 85 · Receiving 425 L/.test(insp) && /MAT-0001\s+Sending 1\.4875 · Receiving 7\.4375 kg/.test(insp), insp.replace(/\n/g, " | "));
if (shot) await page.screenshot({ path: `${shot}-pfd-values.png` });

// Label setting.
await page.getByRole("tab", { name: "Mass Balance" }).click();
await page.getByLabel("PFD labels show").selectOption("id+active");
await page.getByLabel("Active scenario").selectOption("receiving");
await page.getByRole("tab", { name: "PFD", exact: true }).click();
await wait(1200);
lab = await labels();
check("label shows the active scenario only", lab["ST-100L-001"] === "ST-100L-001\nBasal medium\n425 L", JSON.stringify(lab["ST-100L-001"]));
await page.getByRole("tab", { name: "Mass Balance" }).click();
await page.getByLabel("PFD labels show").selectOption("id+both");

// The BOM takes the MB materials.
await page.getByRole("tab", { name: "BOM" }).click();
const totalsText = await text("section[aria-label='Totals']");
check("BOM totals include the MB materials", /MAT-0001[\s\S]*1\.645[\s\S]*8\.225/.test(totalsText) && /MAT-0002[\s\S]*0\.62[\s\S]*3\.1/.test(totalsText), totalsText.slice(0, 160).replace(/\n/g, " | "));
await page.getByRole("tab", { name: "Mass Balance" }).click();

// Replace with v2: change preview.
await chooseFile("Replace…", ex("MB_example_v2.xlsx"), "Replace");
const diffText = await text(".mb-diff");
check("v2: 7 changed rows, 425 → 850", /7 changes/.test(diffText) && /425\s*→\s*850/.test(diffText) && /Not applied yet/.test(await text(".mb-card")), diffText.slice(0, 120).replace(/\n/g, " | "));
await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
await wait(600);
check("history: 2 applies", (await page.locator("section[aria-label='History'] tbody tr").count()) === 2);

// Errors block the apply.
await chooseFile("Replace…", ex("MB_example_errors.xlsx"), "Replace");
head = await text("section[aria-label='Check'] .section-head");
const rulesSeen = await page.locator(".issue-table tbody tr td:nth-child(2)").allInnerTexts();
check("errors file: 7 errors, apply disabled", /7 errors/.test(head) && await page.getByRole("button", { name: "Apply to PFD and BOM" }).isDisabled(), head.replace(/\n/g, " | "));
check("errors file: rules V1 V2 V4 V5 V5 V6 V7", [...rulesSeen].sort().join(" ") === "V1 V2 V4 V5 V5 V6 V7", rulesSeen.join(" "));
check("applied values unchanged (still v2)", /850/.test(await text("section[aria-label='Applied values']")));
if (shot) await page.screenshot({ path: `${shot}-mb-errors.png`, fullPage: true });

// GridCraft round trip on the stored workbook.
const gcInstalled = await page.getByRole("button", { name: "Edit in GridCraft" }).isEnabled();
if (!gcInstalled) check("GridCraft available (run npm run gridcraft first)", false);
else {
  await page.getByLabel("Your name").fill("Tester");
  await page.getByRole("button", { name: "Edit in GridCraft" }).click();
  const frame = page.frameLocator(".gc-frame");
  await frame.locator("canvas").first().waitFor({ timeout: 60000 });
  await wait(6000);
  const src = await page.locator(".gc-frame").getAttribute("src");
  check("GridCraft opens in host mode without its File tab", /host=parent/.test(src) && /chrome=nofiletab/.test(src) && /author=Tester/.test(src), src);
  const box = await page.locator(".gc-frame").boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.6);
  await wait(400);
  await page.keyboard.type("note");
  await page.keyboard.press("Enter");
  await wait(1200);
  check("unsaved changes shown", /Unsaved changes/.test(await text(".gc-bar")));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  check("closing with unsaved changes asks first", await page.getByRole("button", { name: "Close without saving" }).isVisible());
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.6);
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => /Saved to project/.test(document.querySelector(".gc-bar")?.textContent ?? ""), null, { timeout: 20000 });
  await wait(1500);
  const bar = await text(".gc-bar");
  check("Ctrl+S in GridCraft saves to the project and shows the check", /Saved to project/.test(bar) && /7 errors in PCS_LINK/.test(bar), bar.replace(/\n/g, " | "));
  if (shot) await page.screenshot({ path: `${shot}-gridcraft.png` });
  await page.getByRole("button", { name: "Done" }).click();
  await wait(500);
  const card = await text(".mb-card");
  check("workbook now saved in GridCraft", /Saved in GridCraft/.test(card) && /GridCraft/.test(card), card.replace(/\n/g, " | "));
}

// Back to the good workbook, apply, reload, project file.
await chooseFile("Replace…", ex("MB_example.xlsx"), "Replace");
await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
await wait(2000);
await page.reload();
await page.waitForFunction(() => window.__pcsPfd);
await wait(1500);
lab = await labels();
check("after reload: labels keep the values", lab["ST-100L-002"] === "ST-100L-002\nFeed A\nS 5 · R 25 L", JSON.stringify(lab["ST-100L-002"]));
await page.getByRole("tab", { name: "Mass Balance" }).click();
await wait(800);
check("after reload: workbook applied, 3 in history", /Applied/.test(await text(".mb-card")) && (await page.locator("section[aria-label='History'] tbody tr").count()) === 3);
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
const saved = JSON.parse(readFileSync(await dl.path(), "utf8"));
check("project file carries workbook, applied values and history", saved.mb.workbook?.name === "MB_example.xlsx" && saved.mb.workbook.dataBase64.length > 5000 &&
  saved.mb.current?.rows.length === 7 && saved.mb.history.length === 3 && saved.mb.history.some((h) => h.importedBy === "Tester"));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
