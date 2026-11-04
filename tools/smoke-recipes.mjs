// Browser test of prepared materials (recipes) and backup materials, end to end:
// the example project takes the sample recipes and backups (Materials), MB_example_buffer.xlsx gives
// 2.8 / 14 L of sodium bicarbonate 7.5 % in 100L (Mass Balance), and the BOM turns it into its chemicals,
// buys the chemicals, lists the solution as prepared, and shows backups apart from the totals. Then a
// recipe and a backup are made in the dialogs, a loop is refused, and the Excel files carry it all.
// Usage: LANG=C.UTF-8 node tools/smoke-recipes.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const ExcelJS = require("exceljs");

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })).newPage();
// The in-app guide opens on a first visit; these checks run with it closed (tools/smoke-guide.mjs tests it).
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const text = (sel) => page.locator(sel).innerText();
const ex = (f) => resolve("examples", f);
const tab = async (name) => { await page.getByRole("tab", { name, exact: true }).click(); await wait(600); };
const materialsTab = async () => { await page.getByRole("tab", { name: /^Materials/ }).click(); await wait(500); };
/** Rows of one BOM section as the screen shows them: [kind, code, source, Sending total, Receiving total]. */
const bomRows = (uo) => page.evaluate((uo) => [...document.querySelectorAll(`section[aria-label='BOM ${uo}'] tbody tr`)].map((tr) => {
  const td = [...tr.children];
  const kind = tr.classList.contains("bom-part") ? "part" : tr.classList.contains("bom-backup") ? "backup" : "line";
  const src = td[3].querySelector("select");
  return [kind, td[0].innerText.replace(/[↳⇄]/g, "").trim(), src ? src.options[src.selectedIndex].text.split(" (")[0] : td[3].innerText.trim(), td[7].innerText.trim(), td[8].innerText.trim()];
}), uo);
const tableOf = (label) => page.evaluate((label) => Object.fromEntries([...document.querySelectorAll(`section[aria-label='${label}'] tbody tr`)]
  .map((tr) => { const td = [...tr.children].map((c) => c.innerText.trim()); return [td[0], td.slice(4)]; })), label);
const readXlsx = async (dl) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(await dl.path()); return wb; };
const sheetRows = (wb, name) => { const out = []; wb.getWorksheet(name)?.eachRow((r, i) => { if (i > 1) out.push(r.values.slice(1)); }); return out; };

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

// ---- Materials: the sample recipes and backups ------------------------------------------------------------
await materialsTab();
await page.getByRole("button", { name: "Add 15 missing sample(s)" }).click();
await wait(600);
const codes = await page.locator("table.grid tbody tr input[aria-label='Code']").evaluateAll((els) => els.map((e) => e.value));
check("'Add 15 missing samples': 33 materials", codes.length === 33 && ["MAT-0040", "MAT-0043", "MAT-0045"].every((c) => codes.includes(c)), String(codes.length));
check("MAT-0007 and MAT-0011 got the sample recipe, MAT-0008 a backup",
  (await page.getByLabel("Recipe of MAT-0007").innerText()) === "Recipe (2)" && (await page.getByLabel("Recipe of MAT-0011").innerText()) === "Recipe (3)" &&
  (await page.getByLabel("Backups of MAT-0008").innerText()) === "Backups (1)" && (await page.getByLabel("Recipe of MAT-0001").innerText()) === "+ Recipe");
check("nothing left to add: the button is gone", !(await page.getByRole("button", { name: /missing sample|sample recipes/ }).count()));

// ---- Mass Balance: a workbook with the bicarbonate solution in litres ------------------------------------------
await tab("Mass Balance");
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload Excel workbook…" }).click()]);
  await chooser.setFiles(ex("MB_example_buffer.xlsx"));
  await wait(1400);
}
await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
await wait(1200);
check("MB: the solution row is counted, through its recipe", /Counted · recipe: 2 components/.test(await text(".page")));
check("link check: everything lines up", (await text(".link-chip")).trim() === "Linked", await text(".link-chip"));

// ---- BOM: recipe explosion and backups ----------------------------------------------------------------------
await tab("BOM");
let rows = await bomRows("100L");
const at = rows.findIndex((r) => r[1] === "MAT-0007");
check("100L: MAT-0007 from the MB (2.8 / 14 L), then its chemicals from the recipe", at >= 0 &&
  JSON.stringify(rows.slice(at, at + 3)) === JSON.stringify([["line", "MAT-0007", "MB", "2.8", "14"], ["part", "MAT-0040", "Recipe", "0.21", "1.05"], ["part", "MAT-0012", "Recipe", "2.8", "14"]]),
  JSON.stringify(rows.slice(at, at + 3)));
check("the line is marked Prepared and the part says which recipe", /Prepared/.test(await page.locator("section[aria-label='BOM 100L'] tbody tr").nth(at).innerText()) &&
  /Recipe of MAT-0007: 75 kg per 1,000 L/.test(await page.locator("section[aria-label='BOM 100L'] tbody tr").nth(at + 1).innerText()));
let tot = await tableOf("Totals");
check("Totals buy the chemicals, not the solution", tot["MAT-0040"]?.slice(0, 2).join() === "0.21,1.05" && tot["MAT-0012"]?.slice(0, 2).join() === "2.8,14" && !tot["MAT-0007"], JSON.stringify(tot));
check("…and say what comes from recipes", /2\.8 \/ 14 via MAT-0007/.test(tot["MAT-0012"]?.[2] ?? ""), tot["MAT-0012"]?.[2]);
let prep = await tableOf("Prepared in-house");
check("Prepared in-house lists the solution", JSON.stringify(prep) === JSON.stringify({ "MAT-0007": ["2.8", "14", "100L"] }), JSON.stringify(prep));
if (shot) await page.screenshot({ path: `${shot}-bom-recipe.png`, fullPage: true });

// A buffer by hand: 200 / 1000 L of the equilibration buffer, with NaCl (backup MAT-0044) in its recipe.
await page.getByLabel("Material to add to 100L").selectOption({ label: "MAT-0043 · Equilibration Buffer (20 mM Tris, 150 mM NaCl) (L)" });
await page.locator("section[aria-label='BOM 100L']").getByRole("button", { name: "Add", exact: true }).click();
await wait(400);
for (const [label, v] of [["Sending of MAT-0043", "200"], ["Receiving of MAT-0043", "1000"], ["Note for MAT-0043", "Line equilibration (test)"]]) {
  await page.getByLabel(label).fill(v);
  await page.getByLabel(label).press("Enter");
  await wait(300);
}
rows = await bomRows("100L");
const b = rows.findIndex((r) => r[1] === "MAT-0043");
check("a manual buffer line explodes into Tris, NaCl (with its backup) and WFI", JSON.stringify(rows.slice(b, b + 5)) === JSON.stringify([
  ["line", "MAT-0043", "Manual", "200", "1,000"], ["part", "MAT-0009", "Recipe", "0.4846", "2.423"], ["part", "MAT-0008", "Recipe", "1.7532", "8.766"],
  ["backup", "MAT-0044", "Backup", "1.7532", "8.766"], ["part", "MAT-0012", "Recipe", "200", "1,000"],
]), JSON.stringify(rows.slice(b, b + 5)));
tot = await tableOf("Totals");
const alt = await tableOf("Backup materials");
check("WFI total adds both recipes; the backup is not in the totals but in Backup materials",
  tot["MAT-0012"]?.slice(0, 2).join() === "202.8,1,014" && !tot["MAT-0044"] && alt["MAT-0044"]?.slice(0, 3).join() === "1.7532,8.766,MAT-0008", `${JSON.stringify(tot["MAT-0012"])} ${JSON.stringify(alt)}`);

if (shot) {
  await page.locator("section[aria-label='BOM 100L'] tbody tr", { hasText: "MAT-0043" }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shot}-bom-buffer.png` });
  await page.locator("section[aria-label='Backup materials']").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shot}-bom-totals.png` });
}

// A backup from the BOM screen: MAT-0040 (in the recipe of MAT-0007) gets MAT-0004 at ratio 2.
await page.locator("section[aria-label='BOM 100L'] tbody tr.bom-part", { hasText: "MAT-0040" }).getByRole("button", { name: "+ Backup" }).click();
await wait(300);
await page.getByLabel("Backup 1", { exact: true }).selectOption({ label: "MAT-0004 · Glucose (kg)" });
await page.getByLabel("Ratio 1").fill("2");
await page.getByLabel("Backup note 1").fill("test only");
await page.getByRole("button", { name: "Save backups" }).click();
await wait(500);
rows = await bomRows("100L");
const c = rows.findIndex((r) => r[0] === "backup" && r[1] === "MAT-0004");
check("the backup appears under the chemical, quantity × 2", c > 0 && rows[c - 1][1] === "MAT-0040" && rows[c].slice(3).join() === "0.42,2.1", JSON.stringify(rows[c]));
await page.getByRole("button", { name: "Remove backup MAT-0004 for MAT-0040" }).click();
await page.getByRole("button", { name: "Remove backup", exact: true }).click();
await wait(400);
check("…and can be removed again", !(await bomRows("100L")).some((r) => r[1] === "MAT-0004"));

// Excel export of the BOM.
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).click()]);
  const wb = await readXlsx(dl);
  const lines = sheetRows(wb, "BOM");
  const part = lines.find((r) => r[3] === "MAT-0040");
  const backup = lines.find((r) => r[3] === "MAT-0044");
  check("Excel BOM: recipe and backup rows with their kind", part?.[2] === "Recipe of MAT-0007" && part?.[7] === "Recipe" && part?.[11] === 0.21 && backup?.[2] === "Backup for MAT-0008" && backup?.[11] === 1.7532,
    `${JSON.stringify(part)} ${JSON.stringify(backup)}`);
  check("Excel: Prepared and Backups sheets; Totals without the solution", sheetRows(wb, "Prepared").some((r) => r[0] === "MAT-0007") && sheetRows(wb, "Backups").some((r) => r[0] === "MAT-0044") &&
    !sheetRows(wb, "Totals").some((r) => r[0] === "MAT-0007"));
}

// ---- Materials: a new recipe in the dialog, a loop refused, delete keeps recipes consistent -------------------------
await materialsTab();
await page.getByLabel("Recipe of MAT-0010").click();
await wait(300);
await page.getByLabel("Recipe amount").fill("1");
await page.getByLabel("Component 1").selectOption({ label: "MAT-0007 · Sodium Bicarbonate 7.5 % (L)" });
await page.getByLabel("Quantity 1").fill("0.5");
check("a recipe of MAT-0010 with MAT-0007 is fine", await page.getByRole("button", { name: "Save recipe" }).isEnabled());
await page.getByRole("button", { name: "Save recipe" }).click();
await wait(300);
await page.getByLabel("Recipe of MAT-0007").click();
await wait(300);
await page.getByRole("button", { name: "Add component" }).click();
await page.getByLabel("Component 3").selectOption({ label: "MAT-0010 · Sodium Hydroxide 1 N (L)" });
await page.getByLabel("Quantity 3").fill("1");
check("MAT-0007 made of MAT-0010 (made of MAT-0007): loop refused", /makes a loop \(MAT-0007 → MAT-0010 → MAT-0007\)/.test(await text(".dialog")) && !(await page.getByRole("button", { name: "Save recipe" }).isEnabled()), await text(".dialog .notice").catch(() => ""));
if (shot) await page.screenshot({ path: `${shot}-recipe-loop.png` });
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByLabel("Recipe of MAT-0010").click();
await page.getByRole("button", { name: "Remove recipe" }).click();
await wait(300);
check("recipe removed", (await page.getByLabel("Recipe of MAT-0010").innerText()) === "+ Recipe");

await page.getByRole("button", { name: "More for MAT-0044" }).click();
await page.getByRole("menuitem", { name: "Delete MAT-0044" }).click();
await wait(200);
check("deleting a backup material says where it is used", /is a backup for MAT-0008/.test(await text(".dialog")), await text(".dialog"));
await page.getByRole("button", { name: "Delete", exact: true }).click();
await wait(300);
check("…and takes it off MAT-0008", (await page.getByLabel("Backups of MAT-0008").innerText()) === "+ Backup");

// Materials Excel: Recipes and Backups sheets, and importing them back.
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).click()]);
  const wb = await readXlsx(dl);
  const rec = sheetRows(wb, "Recipes");
  check("materials file: a Recipes sheet (one row per component) and a Backups sheet", wb.worksheets.map((w) => w.name).join() === "Materials,Recipes,Backups" &&
    rec.filter((r) => r[0] === "MAT-0043").map((r) => `${r[4]}:${r[6]}`).join() === "MAT-0009:2.423,MAT-0008:8.766,MAT-0012:1000" && sheetRows(wb, "Backups").map((r) => r[0]).join() === "MAT-0015",
    JSON.stringify(rec.slice(0, 3)));
  // Change the recipe in the file (more NaCl) and import it.
  const ws = wb.getWorksheet("Recipes");
  ws.eachRow((r) => { if (r.getCell(1).value === "MAT-0043" && r.getCell(5).value === "MAT-0008") r.getCell(7).value = 9.5; });
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Import Excel/CSV" }).click()]);
  await chooser.setFiles({ name: "materials.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: buf });
  await wait(1200);
  const dlg = await text(".dialog");
  check("import shows the changed recipe", /Recipes 3 \(1 changed\)/.test(dlg) && /Recipes set for MAT-0043/.test(dlg), dlg.replace(/\n/g, " | "));
  await page.getByRole("button", { name: "Apply 1 change(s)" }).click();
  await wait(500);
}
await tab("BOM");
rows = await bomRows("100L");
check("the BOM uses the imported recipe (NaCl 9.5 kg per 1000 L)", rows.some((r) => r[0] === "part" && r[1] === "MAT-0008" && r[3] === "1.9" && r[4] === "9.5"), JSON.stringify(rows.filter((r) => r[1] === "MAT-0008")));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
