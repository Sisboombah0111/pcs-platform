// Browser test of N5.7 (semi-finished products and SAP BOMs): on the downstream example, BOM › Semi-finished
// adds one per unit operation, takes their codes and the plant, a PROA column packing takes the resin, a
// polysorbate spike that SAP would round is fixed by counting it in g, the code rule set to "any" leaves no
// error, and the SAP BOM workbook has the header, items, materials, units and checks with SAP field names. The
// BOM lines stay as they were, and the set-up is still there after a reload.
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
check("Semi-finished sheet: the explanation, and the 14 prepared materials listed (their recipe is their BOM)",
  await page.getByText("Split the BOM into semi-finished products for SAP.").isVisible() && await page.locator(".sf-table tbody tr:has-text('Prepared (recipe)')").count() === 14);
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
check("the example's material codes: one line (39 materials), listed on demand", /^error 39 materials/.test(flat(await codesLine.innerText())));
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
check("BOM header: 8 semi-finished + 14 prepared = 22 BOMs; STOR from ST-FILL-STOR 453.6 L", H.length === 23 && H.some((r) => r[0] === "1000007" && r[5] === "453.6"));
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

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
