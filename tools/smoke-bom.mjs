// Browser test of the BOM with the example project and MB_example.xlsx: lines per UO with their
// sources and quantities (checked against a hand calculation), overage from the material list and
// per line, a manual line with a reason, "Not counted", switching source and back, Excel export,
// and the state after a reload.
// Usage: LANG=C.UTF-8 node tools/smoke-bom.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const ExcelJS = require("exceljs");

const [base, shot] = process.argv.slice(2);
const ex = (f) => resolve("examples", f);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })).newPage();
// The in-app guide opens on a first visit; these checks run with it closed (tools/smoke-guide.mjs tests it).
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);

/** The BOM as the screen shows it: UO code → material code → [source, Sending total, Receiving total]. */
const bomTable = () => page.evaluate(() => {
  const out = {};
  for (const sec of document.querySelectorAll("section[aria-label^='BOM ']")) {
    const uo = sec.getAttribute("aria-label").slice(4);
    out[uo] = {};
    for (const tr of sec.querySelectorAll("tbody tr:not(.bom-sub)")) {
      const td = [...tr.children];
      const src = td[3].querySelector("select");
      const opt = src.options[src.selectedIndex].text.split(" (")[0];
      out[uo][td[0].innerText.trim()] = [opt, td[7].innerText.trim(), td[8].innerText.trim()];
    }
  }
  return out;
});
/** Same table with materials in code order, for comparing. */
const sorted = (t) => Object.fromEntries(Object.entries(t).map(([uo, rows]) => [uo, Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)))]));
const totals = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("section[aria-label='Totals'] tbody tr")]
  .map((tr) => { const td = [...tr.children].map((c) => c.innerText.trim()); return [td[0], [td[4], td[5]]]; })));
const row = (uo, code) => page.locator(`section[aria-label='BOM ${uo}'] tbody tr:not(.bom-sub)`, { has: page.locator("td", { hasText: new RegExp(`^${code}$`) }) });
const commit = async (locator, value) => { await locator.fill(value); await locator.press("Enter"); await wait(400); };

await page.goto(base);
await page.waitForSelector(".excalidraw");
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(ex("example-process.pcs.json"));
  await wait(1500);
}

// Before any MB: the PFD bag links are already BOM lines.
await page.getByRole("tab", { name: "BOM" }).click();
await wait(500);
let t = await bomTable();
check("PFD links make lines before any MB", JSON.stringify(sorted(t)) === JSON.stringify({ "10L": { "MAT-0017": ["PFD", "1", "1"] }, "100L": { "MAT-0017": ["PFD", "1", "1"], "MAT-0018": ["PFD", "1", "1"] } }), JSON.stringify(t));
check("a notice says no MB is applied yet", /No mass balance is applied yet/.test(await page.locator(".page").innerText()));

// Apply MB_example.xlsx.
await page.getByRole("tab", { name: "Mass Balance" }).click();
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload Excel workbook…" }).click()]);
  await chooser.setFiles(ex("MB_example.xlsx"));
  await wait(1200);
  await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
  await wait(500);
}
await page.getByRole("tab", { name: "BOM" }).click();
await wait(500);
t = await bomTable();
// Hand calculation: 10L seed medium 9 L × 17.5 g/L = 0.1575 kg (R 45 L → 0.7875 kg); 100L basal 85 L × 17.5 g/L = 1.4875 kg
// (R 425 L → 7.4375 kg); feed 5 L × 124 g/L = 0.62 kg (R 25 L → 3.1 kg); bags as linked.
check("BOM lines = hand calculation", JSON.stringify(sorted(t)) === JSON.stringify({
  "10L": { "MAT-0001": ["MB", "0.1575", "0.7875"], "MAT-0017": ["PFD", "1", "1"] },
  "100L": { "MAT-0001": ["MB", "1.4875", "7.4375"], "MAT-0002": ["MB", "0.62", "3.1"], "MAT-0017": ["PFD", "1", "1"], "MAT-0018": ["PFD", "1", "1"] },
}), JSON.stringify(t));
let tot = await totals();
check("totals = hand calculation", tot["MAT-0001"].join() === "1.645,8.225" && tot["MAT-0002"].join() === "0.62,3.1" && tot["MAT-0017"].join() === "2,2" && tot["MAT-0018"].join() === "1,1", JSON.stringify(tot));
check("complete, nothing to check", /Complete/.test(await page.locator(".xl-info").innerText()));
if (shot) await page.screenshot({ path: `${shot}-bom.png`, fullPage: true });

// Overage: 10 % on MAT-0001 in the material list, 5 % on one line.
await page.getByRole("tab", { name: "Materials" }).click();
const matRow = page.locator("table.grid tbody tr", { has: page.locator('input[aria-label="Code"][value="MAT-0001"]') });
await commit(matRow.getByLabel("Overage %"), "10");
await page.getByRole("tab", { name: "BOM" }).click();
await wait(400);
await commit(page.getByLabel("Overage of MAT-0002").nth(0), "5");
t = await bomTable();
tot = await totals();
check("overage: material default 10 % and a line's 5 %", t["100L"]["MAT-0001"].join() === "MB,1.6363,8.1813" && t["100L"]["MAT-0002"].join() === "MB,0.651,3.255" && tot["MAT-0001"].join() === "1.8095,9.0475",
  `${t["100L"]["MAT-0001"]} / ${t["100L"]["MAT-0002"]} / ${tot["MAT-0001"]}`);

// A manual line in 100L.
await page.getByLabel("Material to add to 100L").selectOption({ label: "MAT-0012 · Water for Injection (L)" });
await page.locator("section[aria-label='BOM 100L']").getByRole("button", { name: "Add", exact: true }).click();
await wait(400);
check("a new manual line asks for quantities and a reason", /Enter Sending and Receiving\.[\s\S]*Give a reason/.test(await row("100L", "MAT-0012").innerText()));
await commit(page.getByLabel("Sending of MAT-0012"), "50");
await commit(page.getByLabel("Receiving of MAT-0012"), "250");
await commit(page.getByLabel("Note for MAT-0012"), "Line flush before inoculation");
t = await bomTable();
check("manual line counted", t["100L"]["MAT-0012"].join() === "Manual,50,250" && !/Give a reason/.test(await row("100L", "MAT-0012").innerText()), JSON.stringify(t["100L"]["MAT-0012"]));

// Not counted, then switch a source and reset it.
await page.getByLabel("Source of MAT-0017").nth(1).selectOption("excluded");
await wait(400);
tot = await totals();
check("'Not counted' leaves the totals", tot["MAT-0017"].join() === "1,1", JSON.stringify(tot["MAT-0017"]));
await page.getByLabel("Source of MAT-0001").nth(1).selectOption("manual");
await wait(400);
const basal = await row("100L", "MAT-0001").innerText();
tot = await totals();
check("switching MB → Manual: MB value not counted, said so, total marked ≥", /mass balance also has it/.test(basal) && /^≥/.test(tot["MAT-0001"][0]), `${tot["MAT-0001"]}`);
await row("100L", "MAT-0001").getByRole("button", { name: "Reset" }).click();
await wait(400);
t = await bomTable();
check("Reset goes back to MB", t["100L"]["MAT-0001"].join() === "MB,1.6363,8.1813", JSON.stringify(t["100L"]["MAT-0001"]));
if (shot) await page.screenshot({ path: `${shot}-bom-edited.png`, fullPage: true });

// Excel export.
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).click()]);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(await dl.path());
const sheetRows = (name) => { const out = []; wb.getWorksheet(name).eachRow((r, i) => { if (i > 1) out.push(r.values.slice(1)); }); return out; };
const lines = sheetRows("BOM");
const wfi = lines.find((r) => r[3] === "MAT-0012");
const tw = sheetRows("Totals").find((r) => r[0] === "MAT-0001");
check("Excel: BOM sheet with every line, Totals with numbers", lines.length === 7 && wfi && wfi[2] === "Line" && wfi[7] === "Manual" && wfi[11] === 50 && wfi[12] === 250 && wfi[13] === "Line flush before inoculation" &&
  tw && tw[4] === 1.8095 && tw[5] === 9.0475, `${dl.suggestedFilename()} ${lines.length} lines; ${JSON.stringify(wfi)}; ${JSON.stringify(tw)}`);

// Reload: stored lines and settings stay.
await wait(1500);
await page.reload();
await page.waitForSelector(".excalidraw");
await page.getByRole("tab", { name: "BOM" }).click();
await wait(600);
t = await bomTable();
check("after reload: manual line, Not counted and overage kept", t["100L"]["MAT-0012"].join() === "Manual,50,250" && t["100L"]["MAT-0017"][0] === "Not counted" && t["100L"]["MAT-0002"].join() === "MB,0.651,3.255", JSON.stringify(t["100L"]));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
