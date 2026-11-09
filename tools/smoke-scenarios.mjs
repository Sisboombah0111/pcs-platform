// Browser test of N4.16: a third scenario (Mass Balance › Scenarios: add, rename, column), its values read from
// a PCS_LINK column added to the workbook, shown on the BOM and the PFD labels; removing it and undo; the
// material view (Where used with quantities per unit operation and scenario, total, packs, facts).
// Usage: LANG=C.UTF-8 node tools/smoke-scenarios.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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
const text = (sel) => page.locator(sel).first().innerText();
const tab = async (name) => { await page.getByRole("tab", { name: name === "Materials" ? /^Materials/ : name, exact: name !== "Materials" }).click(); await wait(500); };
const totalsHead = () => page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] thead th")].map((th) => th.innerText.trim()));
const labels = () => page.evaluate(() => window.__pcsPfd.all().filter((e) => e.type === "text" && e.customData?.pcs?.label).map((e) => e.originalText ?? e.text));

// The downstream MB workbook with a "Clinical 500 L" column: a quarter of Sending on every row.
const wbPath = resolve(tmpdir(), `MB_downstream_clinical_${process.pid}.xlsx`);
{
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(resolve("examples/MB_downstream.xlsx"));
  const ws = wb.getWorksheet("PCS_LINK");
  const head = ws.getRow(1).values;
  const iS = head.indexOf("Sending"), col = head.length;
  ws.getRow(1).getCell(col).value = "Clinical 500 L";
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const v = r.getCell(iS).value;
    const n = typeof v === "number" ? v : v && typeof v === "object" && typeof v.result === "number" ? v.result : null;
    if (n !== null) r.getCell(col).value = Number((n / 4).toPrecision(10));
  });
  await wb.xlsx.writeFile(wbPath);
}

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

// ---- a third scenario ---------------------------------------------------------------------------------------------------------
await tab("Mass Balance");
await page.getByRole("button", { name: /^Scenarios \(2\)/ }).click();
await page.getByRole("button", { name: "+ Scenario" }).click();
await page.getByLabel("Name of scenario 3").fill("Clinical 500 L");
check("the column follows the name until it is changed", (await page.getByLabel("Column of scenario 3").inputValue()) === "Clinical 500 L");
await page.getByLabel("Column of scenario 1").fill("Unit");
check("a fixed PCS_LINK column is refused", /fixed PCS_LINK column/.test(await text(".dialog")) && await page.getByRole("button", { name: "Save", exact: true }).isDisabled());
await page.getByLabel("Column of scenario 1").fill("Sending");
await page.getByLabel("Name of scenario 1").fill("Sending 2,000 L");
await page.getByLabel("Column of scenario 1").fill("Sending");
if (shot) await page.locator(".dialog").screenshot({ path: `${shot}-dialog.png` });
await page.getByRole("button", { name: "Save", exact: true }).click();
await wait(500);
await page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: /^Check/ }).click();
check("three scenarios; the workbook check says the new column is missing", /Scenarios \(3\)/.test(await text(".ribbon")) && /No 'Clinical 500 L' column for the scenario Clinical 500 L/.test(await text(".page")));
await tab("BOM");
let head = await totalsHead();
check("BOM totals: a column per scenario (renamed one included)", head.includes("Sending 2,000 L") && head.includes("Receiving") && head.includes("Clinical 500 L"), head.join(" | "));

// ---- its values from the workbook ----------------------------------------------------------------------------------------------
await tab("Mass Balance");
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Replace…" }).click()]);
  await chooser.setFiles(wbPath);
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await wait(1500);
}
await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
await wait(1500);
await tab("BOM");
head = await totalsHead();
const row = await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] tbody tr")].map((tr) => [...tr.children].map((c) => c.innerText.trim())).find((t) => t[0] === "UTL-0001"));
const n = (s) => Number(String(s).replace(/[^\d.]/g, ""));
const iS = head.indexOf("Sending 2,000 L"), iC = head.indexOf("Clinical 500 L");
check("after applying: WFI for the clinical batch about a quarter of Sending", row && n(row[iC]) > 0 && Math.abs(n(row[iC]) * 4 / n(row[iS]) - 1) < 0.05, row ? `${row[iS]} → ${row[iC]}` : "no row");
await tab("PFD");
await wait(800);
const ls = await labels();
check("PFD labels: S · R · C values", ls.some((t) => /S [\d,.]+ · R [\d,.]+ · C [\d,.]+ L/.test(t)), ls.slice(0, 3).join(" | "));

// ---- remove it, undo ------------------------------------------------------------------------------------------------------------
await tab("Mass Balance");
await page.getByRole("button", { name: /^Scenarios \(3\)/ }).click();
await page.getByRole("button", { name: "Remove scenario 3" }).click();
check("removing says what happens to its values", /Removed: Clinical 500 L\. Its applied values and manual BOM quantities stay/.test(await text(".dialog")));
await page.getByRole("button", { name: "Save", exact: true }).click();
await wait(400);
await tab("BOM");
check("BOM: back to two scenarios", !(await totalsHead()).includes("Clinical 500 L"));
await page.getByRole("button", { name: "Undo change" }).click();
await wait(400);
check("undo brings the scenario and its values back", (await totalsHead()).includes("Clinical 500 L"));

// ---- the material view ---------------------------------------------------------------------------------------------------------
await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] tbody tr")].find((tr) => tr.children[0].innerText.trim() === "CHM-0002")?.scrollIntoView());
await page.locator("tr[data-bom-line='PROA|BUF-1001-B']").locator("xpath=following-sibling::tr").filter({ hasText: "CHM-0002" }).first().locator(".code-link").click();
await wait(500);
const dlg = (await text(".dialog")).replace(/\n/g, " | ");
const qty = await page.locator("section[aria-label='Quantities'] tbody tr").allInnerTexts();
check("material view: facts, quantities per unit operation and scenario, a total", /Unit \| kg/.test(dlg) && /Category \| Chemical/.test(dlg) && qty.length >= 4 && /^Total/.test(qty[qty.length - 1]) && /In BUF-1001-B/.test(qty.join(" ")) && (await page.locator("section[aria-label='Quantities'] thead th").allInnerTexts()).includes("Clinical 500 L"), `${qty.length} rows; ${qty.slice(-1)[0]}`);
if (shot) await page.locator(".dialog").screenshot({ path: `${shot}-material.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
