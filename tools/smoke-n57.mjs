// Browser test of N5.7 (semi-finished products and SAP BOMs): on the downstream example, BOM › Semi-finished
// adds one per unit operation, takes their codes and the plant, a PROA column packing takes the resin, a
// polysorbate spike that SAP would round is fixed by counting it in g, the code rule set to "any" leaves no
// error, and the SAP BOM workbook has the header, items, materials, units and checks with SAP field names. The
// BOM lines stay as they were, and the set-up is still there after a reload. Then: a list pasted from Excel
// (Paste a list…) and a column of codes pasted into a code cell; UFDF's DF buffer split by MB stream between the
// run and an unpacking; a packing evaluation buffer used by three columns made once (Shared preparation).
// Usage: LANG=C.UTF-8 node tools/smoke-n57.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const ExcelJS = require("exceljs");

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const flat = (s) => s.replace(/\s+/g, " ").trim();
const tab = async (name) => { await page.getByRole("tab", { name, exact: true }).click(); await wait(600); };
const sheetTab = async (re) => { await page.getByRole("tab", { name: re }).click(); await wait(600); };
const panel = (label) => page.locator(`section[aria-label='${label}']`);
const sfRows = () => page.locator(".sf-table tbody tr");
const snap = async (name) => { if (shot) await page.screenshot({ path: `${shot}-${name}.png` }); };
const sheets = async (dl) => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(await dl.path());
  const out = {};
  wb.eachSheet((ws) => { out[ws.name] = { ws, rows: [] }; ws.eachRow((r) => out[ws.name].rows.push(Array.from(r.values.slice(1), (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v))))); });
  return out;
};

// The downstream example with a polysorbate spike on PROA (0.01575 kg in Receiving): SAP would keep 0.016.
const dir = mkdtempSync(join(tmpdir(), "pcs-n57-"));
const file = join(dir, "downstream-spike.pcs.json");
{
  const p = JSON.parse(readFileSync(resolve("examples/example-downstream.pcs.json"), "utf8"));
  const proa = p.uos.find((u) => u.code === "PROA").id;
  const ps80 = p.materials.find((m) => m.code === "CHM-0009").id;
  p.bom.lines[proa] = [...(p.bom.lines[proa] ?? []), { materialId: ps80, qtySource: "manual", manualQty: { sending: 0.0021, receiving: 0.01575 }, note: "PS80 spike" }];
  // A packing evaluation buffer, 400 L batches with one filter each, 100 L for the packing of each of three columns.
  const nacl = p.materials.find((m) => m.code === "CHM-0002").id;
  p.materials.push({ id: "mat_n57flt", code: "FLT-0090", name: "PKE buffer filter", unit: "EA", category: "Filter" });
  p.materials.push({ id: "mat_n57pke", code: "BUF-9001", name: "Column packing evaluation buffer", unit: "L", category: "Buffer", recipe: { per: 100, batch: 400, components: [{ materialId: nacl, qty: 2 }, { materialId: "mat_n57flt", qty: 1, basis: "batch" }] } });
  for (const code of ["PROA", "CEX", "MMC"]) {
    const id = p.uos.find((u) => u.code === code).id;
    p.bom.lines[id] = [...(p.bom.lines[id] ?? []), { materialId: "mat_n57pke", qtySource: "manual", manualQty: { sending: 100, receiving: 100 }, note: "packing evaluation" }];
  }
  writeFileSync(file, JSON.stringify(p));
}

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForSelector(".excalidraw");
await page.evaluate(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith("pcs.bom.")) localStorage.removeItem(k); } catch { /* */ } });
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__pcsPfd?.all().some((e) => e.customData?.pcs?.streamId === "ST-PROA-CEX"));
  await wait(1200);
}
await tab("BOM");
const resinLine = async () => flat(await page.locator("tr[data-bom-line='PROA|RES-0001']").innerText());
await sheetTab(/^PROA/);
const before = await resinLine();

// 1. The sheet before any set-up: the prepared materials are listed already.
await sheetTab(/^Semi-finished/);
check("Semi-finished sheet: the explanation, and the 15 prepared materials listed (their recipe is their BOM)",
  await page.getByText("Split the BOM into semi-finished products for SAP.").isVisible() && await page.locator(".sf-table tbody tr:has-text('Prepared (recipe)')").count() === 15);
await snap("1-start");

// 2. One per unit operation, codes, plant.
await page.getByRole("button", { name: "Add one for every unit operation" }).click();
await wait(500);
const codeInputs = page.locator(".sf-table input[aria-label^='SAP code']");
check("Add one for every unit operation: 7 rows, named after them, bases from the transfers out", await codeInputs.count() === 7
  && /ST-PROA-CEX · 2,824\.8 L \(out\)/.test(flat(await sfRows().nth(0).innerText() + await sfRows().nth(0).locator("select").evaluate((s) => s.options[s.selectedIndex].text))));
for (let i = 0; i < 7; i++) await codeInputs.nth(i).fill(String(1000001 + i));
await page.locator("section[aria-label='SAP settings'] input[placeholder='e.g. 1000']").fill("1000");
await wait(300);
// STOR has no transfer out: choose its stream.
const sfRow = (kind, uo) => sfRows().filter({ has: page.locator("td:nth-child(1)", { hasText: kind }) }).filter({ has: page.locator("td:nth-child(2)", { hasText: new RegExp(`^${uo}$`) }) }).first();
const stor = sfRow("Unit operation", "STOR");
check("STOR: no transfer out, so the base asks for a stream (an error until then)", /Choose the output stream/.test(await stor.locator("select").evaluate((s) => s.options[s.selectedIndex].text)) && /error/.test(await stor.innerText()));
await stor.locator("select").selectOption("ST-FILL-STOR");
await wait(300);

// 3. A column packing for PROA takes the resin.
await panel("Semi-finished products").locator("select[aria-label='Kind of semi-finished product to add']").selectOption("packing");
await panel("Semi-finished products").getByRole("button", { name: "Add", exact: true }).click();
await wait(500);
const packRow = sfRow("Column packing", "PROA");
await packRow.locator("input[aria-label^='SAP code']").fill("1000101");
await wait(300);
const items = panel("Items of 1000101");
check("the new packing is shown, with no items yet", await items.isVisible() && /No items yet/.test(await items.innerText()));
await items.locator("select[aria-label^='Line of PROA']").selectOption({ label: "RES-0001 · Protein A resin" });
await items.getByRole("button", { name: "Add", exact: true }).click();
await wait(400);
check("the packing takes RES-0001: 330 L (manual line), base 1 EA", /0010\s+RES-0001\s+Protein A resin\s+330\.000\s+L/.test(await items.locator("tbody").innerText()) && /for 1 EA/.test(await items.locator(".section-head").innerText()));
await sfRow("Unit operation", "PROA").locator("button.linkish").click();
await wait(400);
const proaItems = panel("Items of 1000001");
const proaText = await proaItems.locator("tbody").innerText();
check("PROA's own BOM: no resin any more; its buffers per batch, before overage", !/RES-0001/.test(proaText) && /BUF-1001-T\s+.*14520\.000/.test(flat(proaText)), flat(proaText).slice(0, 160));
await snap("2-items");

// 4. The spike SAP would round: an error with a fix.
const checks = panel("SAP checks");
const spike = checks.locator("li", { hasText: "CHM-0009: 0.01575 KG is kept as 0.016 (1.6 % off)" });
check("the PS80 spike: 0.01575 kg would be kept as 0.016, an error with “Use g”", await spike.count() === 1 && await spike.getByRole("button", { name: "Use g (1 kg = 1,000 g)" }).isVisible());
await snap("3-checks");
await spike.getByRole("button", { name: "Use g (1 kg = 1,000 g)" }).click();
await wait(400);
check("after “Use g”: the item is 15.750 G and the check is gone", /CHM-0009\s+Polysorbate 80\s+15\.750\s+G/.test(await proaItems.locator("tbody").innerText()) && await checks.locator("li", { hasText: "CHM-0009: 0.01575" }).count() === 0);

// 5. Codes: the example's codes are not 7-digit numbers (one line, listed on demand); "any code" leaves no error.
const codesLine = checks.locator("li", { hasText: "have codes that are not a 7-digit number" });
check("the example's material codes: one line (41 materials), listed on demand", /^error 41 materials/.test(flat(await codesLine.innerText())));
await panel("SAP settings").locator("input[title^='Material numbers are numbers']").fill("0");
await wait(400);
const head = flat(await panel("Semi-finished products").locator(".section-head").innerText());
check("codes: any code → no error, no warning: “Ready for SAP”", /Ready for SAP/.test(head) && !/error/.test(head), head);

// 6. The workbook.
const [dl] = await Promise.all([page.waitForEvent("download"), panel("Semi-finished products").getByRole("button", { name: "SAP BOM Excel…" }).click()]);
const x = await sheets(dl);
check("workbook: BOM header, BOM items, Materials, Units, Checks, About", Object.keys(x).join(",") === "BOM header,BOM items,Materials,Units,Checks,About", Object.keys(x).join(","));
const H = x["BOM header"].rows, I = x["BOM items"].rows;
const today = new Date().toLocaleDateString("sv-SE").replace(/-/g, ".");
check("BOM header: MATNR … STKTX; 1000001 at plant 1000, base 2,824.8 L, valid from today (YYYY.MM.DD)",
  H[0].slice(0, 9).join(",") === "MATNR,WERKS,STLAN,STLAL,DATUV,BMENG,BMEIN,STLST,STKTX" && H.some((r) => r.slice(0, 8).join("|") === `1000001|1000|1|1|${today}|2824.8|L|1`), H[2]?.join("|"));
check("BOM header: 8 semi-finished + 15 prepared = 23 BOMs; STOR from ST-FILL-STOR 453.6 L", H.length === 24 && H.some((r) => r[0] === "1000007" && r[5] === "453.6"));
check("BOM items: 0010 text, CEX takes 1000001 2,824.8 L; the packing has RES-0001; PS80 15.75 G",
  I.some((r) => r.slice(0, 9).join("|") === "1000002|1000|1|1|0010|L|1000001|2824.8|L") && I.some((r) => r[0] === "1000101" && r[6] === "RES-0001" && r[7] === "330") && I.some((r) => r[0] === "1000001" && r[6] === "CHM-0009" && r[7] === "15.75" && r[8] === "G" && r[10] === "10"));
const posCell = x["BOM items"].ws.getRow(2).getCell(5);
check("POSNR is text (0010), MENGE has 3 decimals", posCell.value === "0010" && posCell.numFmt === "@" && x["BOM items"].ws.getRow(2).getCell(8).numFmt === "0.000");
check("Units: CHM-0009 KG ↔ G, UMREZ 1 / UMREN 1000", x.Units.rows.some((r) => r.slice(0, 5).join("|") === "CHM-0009|KG|G|1|1000"));
check("Materials: semi-finished HALB, raw ROH", x.Materials.rows.some((r) => r[0] === "1000101" && r[2] === "HALB") && x.Materials.rows.some((r) => r[0] === "BUF-1001" && r[2] === "HALB") && x.Materials.rows.some((r) => r[0] === "RES-0001" && r[2] === "ROH"));

// 7. The BOM lines did not change; the ribbon's SAP BOM exports too; the set-up survives a reload.
await sheetTab(/^PROA/);
check("the BOM line of RES-0001 on PROA is as before (330 L, manual)", (await resinLine()) === before, await resinLine());
const [dl2] = await Promise.all([page.waitForEvent("download"), page.locator(".ribbon").getByRole("button", { name: "SAP BOM" }).click()]);
check("ribbon › SAP BOM downloads the workbook", /SAP BOM \d{4}-\d{2}-\d{2}\.xlsx$/.test(dl2.suggestedFilename()), dl2.suggestedFilename());
await wait(1500);
await page.reload();
await page.waitForSelector(".excalidraw");
await wait(1500);
await tab("BOM");
await sheetTab(/^Semi-finished \(8\)/);
check("after a reload: 8 semi-finished products, the packing with its resin", await page.locator(".sf-table input[aria-label^='SAP code']").count() === 8 && /1000101/.test(await panel("Semi-finished products").innerText().then(() => page.locator(".sf-table input[aria-label^='SAP code']").evaluateAll((els) => els.map((e) => e.value).join(",")))));

// 8. A list pasted from Excel: PROA's code changed, an unpacking for UFDF added.
const sfPanel = panel("Semi-finished products");
await sfPanel.getByRole("button", { name: "Paste a list…" }).click();
await page.locator(".dialog textarea[aria-label='Pasted rows']").fill("Unit operation\tKind\tSAP code\tName\nPROA\tUnit operation\t1000011\tProtein A capture\nUFDF\t언패킹\t1000105\tUFDF flush and storage\nXYZ\t\t1000099\t");
await wait(300);
const prev = flat(await page.locator(".dialog table").innerText());
check("Paste a list…: a preview (update PROA, add the UFDF unpacking, skip an unknown unit operation)", /2 PROA Unit operation 1000011 Protein A capture Update/.test(prev) && /3 UFDF Unpacking 1000105 UFDF flush and storage Add/.test(prev) && /4 \? Unit operation 1000099 Skip: unit operation not found/.test(prev), prev);
await page.locator(".dialog").getByRole("button", { name: /^Apply/ }).click();
await wait(500);
const codesNow = () => page.locator(".sf-table input[aria-label^='SAP code']").evaluateAll((els) => els.map((e) => e.value));
check("applied: 9 semi-finished products, PROA's run is 1000011, the UFDF unpacking 1000105", (await codesNow()).length === 9 && (await codesNow()).includes("1000011") && (await codesNow()).includes("1000105"), (await codesNow()).join(","));

// 9. A column of codes pasted into CEX's code cell fills CEX and MMC.
await sfRow("Unit operation", "CEX").locator("input[aria-label^='SAP code']").evaluate((el) => {
  const dt = new DataTransfer(); dt.setData("text/plain", "2000002\r\n2000003\r\n");
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await wait(400);
check("a column pasted into CEX's code: CEX 2000002, MMC 2000003", (await sfRow("Unit operation", "CEX").locator("input[aria-label^='SAP code']").inputValue()) === "2000002" && (await sfRow("Unit operation", "MMC").locator("input[aria-label^='SAP code']").inputValue()) === "2000003");

// 10. UFDF's DF buffer (ST-UFDF-003 7,200 L + ST-UFDF-005 918 L): the flush stream to the unpacking.
await sfRow("Unit operation", "UFDF").locator("button.linkish").click();
await wait(400);
const ufdfItems = panel("Items of 1000005");
await ufdfItems.getByRole("button", { name: "Split BUF-5001…" }).click();
await wait(300);
const dlg = page.locator(".dialog");
await dlg.locator("fieldset", { hasText: "1000105" }).getByLabel("MB streams").check();
await dlg.locator("fieldset", { hasText: "1000105" }).locator("label", { hasText: "ST-UFDF-005" }).locator("input").check();
await wait(200);
const dlgText = flat(await dlg.innerText());
check("Split…: the streams with their values; 7,200 L stay on the run", /ST-UFDF-003 · 7,200 L/.test(dlgText) && /ST-UFDF-005 · 918 L/.test(dlgText) && /Stays on the run: 7,200 L/.test(dlgText), dlgText.slice(0, 300));
if (shot) await page.screenshot({ path: `${shot}-4-split.png` });
await dlg.getByRole("button", { name: "Save" }).click();
await wait(400);
const ufdfRow = flat(await ufdfItems.locator("tr", { hasText: "BUF-5001" }).innerText());
check("UFDF's run keeps 7,200 L of BUF-5001 (rest of the line)", /7200\.000/.test(ufdfRow) && /MB \(rest\)/.test(ufdfRow) && /Rest of the line/.test(ufdfRow), ufdfRow);
await sfRow("Unpacking", "UFDF").locator("button.linkish").click();
await wait(400);
check("the unpacking takes 918 L from ST-UFDF-005", /BUF-5001.*918\.000\s*L.*MB · ST-UFDF-005/.test(flat(await panel("Items of 1000105").locator("tbody").innerText())));

// 11. The packing evaluation buffer: made once for its three lines → 1 filter instead of 3.
const flt = async () => flat(await page.locator("section[aria-label='Totals'] tr", { hasText: "FLT-0090" }).innerText());
await sheetTab(/^Totals/);
const before3 = await flt();
await page.getByRole("tab", { name: /^Materials/ }).click();
await wait(700);
await page.getByLabel("Recipe of BUF-9001").click();
await wait(300);
await page.getByLabel("Made once for all its BOM lines").check();
await page.locator(".dialog").getByRole("button", { name: "Save recipe" }).click();
await wait(400);
await tab("BOM");
await sheetTab(/^Totals/);
const after1 = await flt();
check("shared preparation: FLT-0090 3 → 1 (one 400 L batch for 300 L)", /\b3\s+3\b/.test(before3) && /\b1\s+1\b/.test(after1), `${before3} → ${after1}`);
await sheetTab(/^PROA/);
const pke = flat(await page.locator("tr[data-bom-line='PROA|BUF-9001'] td.bom-mat").getAttribute("data-full") ?? "");
check("the PROA line says it is prepared once for its 3 lines", /Prepared once for its 3 lines \(PROA, CEX, MMC\)/.test(pke), pke.slice(0, 200));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
