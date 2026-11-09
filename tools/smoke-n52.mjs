// Browser test of N5.2 (Office look): the title bar and the ribbon (each screen's own buttons, full or one line),
// Excel green on the table screens and PowerPoint orange on the PFD, cells selected like in Excel with Average,
// Count and Sum in the status bar, Ctrl+C copies them as cells, and the status bar zoom.
// Usage: LANG=C.UTF-8 node tools/smoke-n52.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ["clipboard-read", "clipboard-write"] });
await ctx.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(base);
await page.waitForSelector(".excalidraw");
await page.getByRole("button", { name: /^Open the example/ }).click();
const d = page.getByRole("button", { name: "Open without saving" });
if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
await page.waitForTimeout(2000);
const tab = async (re) => { await page.getByRole("tab", { name: re }).click(); await page.waitForTimeout(600); };
const groups = () => page.locator(".ribbon .rgroup").evaluateAll((gs) => gs.map((g) => g.getAttribute("aria-label")));
const chrome = () => page.locator(".titlebar").evaluate((e) => getComputedStyle(e).backgroundColor);

// ---- the ribbon follows the screen ----------------------------------------------------------------------------------
check("PFD: PowerPoint orange title bar", (await chrome()) === "rgb(196, 62, 28)", await chrome());
check("PFD ribbon: File, Insert, View, Export, History", JSON.stringify(await groups()) === JSON.stringify(["File", "Insert", "View", "Export", "History"]), JSON.stringify(await groups()));
check("PFD ribbon: Fit and Export to PowerPoint…", (await page.getByRole("button", { name: "Fit", exact: true }).isVisible()) && (await page.getByRole("button", { name: "Export to PowerPoint…" }).isVisible()));
if (shot) await page.screenshot({ path: `${shot}-pfd.png` });
await tab(/^BOM/);
check("BOM: Excel green title bar", (await chrome()) === "rgb(33, 115, 70)", await chrome());
check("BOM ribbon: Revisions, Save revision…, Export to Excel", (await page.getByRole("button", { name: /^Revisions \(\d+\)$/ }).isVisible()) && (await page.getByRole("button", { name: "Save revision…" }).isVisible()) && (await page.getByRole("button", { name: "Export to Excel" }).count()) === 1);
check("the PFD buttons are not in the BOM ribbon", (await page.getByRole("button", { name: "Export to PowerPoint…" }).count()) === 0);
await tab(/^Mass Balance/);
check("Mass Balance ribbon: Workbook, Apply, Applied values", (await groups()).some((g) => /^Workbook · MB_downstream\.xlsx$/.test(g)) && (await groups()).includes("Apply to PFD and BOM") && (await groups()).includes("Applied values") && (await page.getByRole("button", { name: "Edit in GridCraft" }).isVisible()) && (await page.getByRole("button", { name: "Applied" }).isDisabled()));
// ---- Mass Balance as a workbook: one bar, sheets at the bottom, a formula bar ----
const sheets = page.getByRole("tablist", { name: "Sheets" });
const sheetNames = await sheets.getByRole("tab").allInnerTexts();
check("Mass Balance sheets: Streams, Material totals, Check, Changes, History", /^Streams \(43\)$/.test(sheetNames[0]) && /^Material totals \(26\)$/.test(sheetNames[1]) && /Check/.test(sheetNames[2]) && /^Changes \(0\)$/.test(sheetNames[3]) && /^History/.test(sheetNames[4]), JSON.stringify(sheetNames));
check("an applied workbook opens on Streams, the bar says it is applied", await page.locator("section[aria-label='Streams']").isVisible() && /0 errors[\s\S]*Applied/.test(await page.locator(".mb-bar").innerText()));
const sending = page.locator("section[aria-label='Streams'] tbody tr", { has: page.locator("td", { hasText: /^ST-PROA-001$/ }) }).locator("td.num").first();
await sending.click();
const fb = (await page.locator(".xl-fbar").innerText()).replace(/\s+/g, " ");
check("click a value: the formula bar shows its cell, its PCS_LINK formula and source", /^E2 /.test(fb) && /=MB_calc!C57/.test(fb) && /from PCS_LINK!D2/.test(fb) && /1,900/.test(fb), fb);
await sheets.getByRole("tab", { name: /^Material totals/ }).click();
check("Material totals: column letters and row numbers, as in a sheet", (await page.locator("section[aria-label='Material totals'] thead tr.xl-letters th").nth(1).innerText()) === "A" && (await page.locator("section[aria-label='Material totals'] tbody td.rn").first().innerText()) === "2");
await sheets.getByRole("tab", { name: /^Check/ }).click();
check("Check sheet: no problems found", /No problems found/.test(await page.locator("section[aria-label='Check']").innerText()));
await sheets.getByRole("tab", { name: /^Streams/ }).click();
await tab(/^Materials/);
check("Materials ribbon: Add material, Import, Export", (await page.getByRole("button", { name: "Add material" }).isVisible()) && (await page.getByRole("button", { name: "Import Excel/CSV" }).isVisible()));
const headBg = await page.locator("table.grid th").first().evaluate((e) => getComputedStyle(e).backgroundColor);
check("tables: tinted header row and gridlines on every cell", headBg !== "rgba(0, 0, 0, 0)" && (await page.locator("table.grid td").nth(3).evaluate((e) => getComputedStyle(e).borderLeftWidth)) === "1px", headBg);

// ---- cells: select, sum, copy ---------------------------------------------------------------------------------------
const cell = (r, c) => page.locator(`table.grid tbody tr:nth-child(${r}) > td:nth-child(${c})`).first();
const overage = await page.locator("table.grid thead th").evaluateAll((ths) => ths.findIndex((t) => /^Overage/.test(t.textContent.trim())) + 1);
await cell(1, overage).click({ position: { x: 4, y: 4 } });
check("one cell: selected, no sums", (await page.locator("td.cell-cur").count()) === 1 && (await page.locator(".sb-stats").innerText()).trim() === "");
await cell(5, overage).click({ position: { x: 4, y: 4 }, modifiers: ["Shift"] });
const shown = await Promise.all([1, 2, 3, 4, 5].map((r) => cell(r, overage).locator("input").inputValue().catch(() => cell(r, overage).innerText())));
const want = shown.map(Number).reduce((a, b) => a + b, 0);
const stats = (await page.locator(".sb-stats").innerText()).replace(/\s+/g, " ");
check("Shift+click: five cells, Average · Count · Sum in the status bar", (await page.locator("td.cell-sel").count()) === 5 && stats.includes("Count: 5") && stats.includes(`Sum: ${want}`), stats);
await cell(1, 2).click({ position: { x: 4, y: 4 } });
await cell(3, 4).click({ position: { x: 4, y: 4 }, modifiers: ["Shift"] });
check("text cells: Count only", /^Count: 9$/.test((await page.locator(".sb-stats").innerText()).trim()), await page.locator(".sb-stats").innerText());
await page.keyboard.press("Control+c");
await page.waitForTimeout(200);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check("Ctrl+C copies the cells as rows and tabs (pastes into Excel as cells)", clip.split("\r\n").length === 3 && clip.split("\r\n").every((r) => r.split("\t").length === 3) && /^CHM-0001\t/.test(clip), JSON.stringify(clip.slice(0, 60)));
await page.keyboard.press("Escape");
check("Escape clears the selection", (await page.locator("td.cell-sel, td.cell-cur").count()) === 0);

// ---- the keyboard, as in Excel -----------------------------------------------------------------------------------
await page.locator("tr[data-code='CHM-0001'] td").nth(1).click({ position: { x: 3, y: 3 } });
await page.evaluate(() => document.activeElement?.blur?.());
const curText = () => page.locator("td.cell-cur").innerText().then((t) => t.trim()).catch(() => "");
await page.keyboard.press("ArrowDown");
check("↓ moves the active cell down", /CHM-0002/.test(await page.locator("td.cell-cur").evaluate((td) => td.parentElement.dataset.code ?? "")));
await page.keyboard.press("Shift+ArrowDown");
await page.keyboard.press("Shift+ArrowDown");
check("Shift+↓ extends the selection (3 cells, Count: 3)", (await page.locator("td.cell-sel").count()) === 3 && /Count: 3/.test(await page.locator(".sb-stats").innerText()));
const ovIn = (code) => page.locator(`tr[data-code='${code}'] input[aria-label='Overage %']`);
await ovIn("CHM-0001").click();
await page.keyboard.press("ArrowDown");
check("↓ in a cell's field goes into the field below", await ovIn("CHM-0002").evaluate((el) => el === document.activeElement));
await page.keyboard.press("Escape");
await page.evaluate(() => document.activeElement?.blur?.());
{
  const box = await ovIn("CHM-0003").locator("xpath=..").boundingBox();
  await page.mouse.click(box.x + 2, box.y + 2);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.type("12");
  const typed = await ovIn("CHM-0003").inputValue();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const below = await page.locator("td.cell-cur").evaluate((td) => td.parentElement.dataset.code);
  check("typing on a selected cell replaces its value; Enter goes to the cell below", typed === "12" && below === "CHM-0004", `${typed} · ${below}`);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  check("Ctrl+Z takes the typed value back", (await ovIn("CHM-0003").inputValue()) === "5");
  await page.keyboard.press("Escape");
}
await page.keyboard.press("Control+f");
check("Ctrl+F goes to the screen's search box", await page.getByLabel("Search materials").evaluate((el) => el === document.activeElement));
await page.evaluate(() => document.activeElement?.blur?.());

// ---- zoom (table screens) -------------------------------------------------------------------------------------------
const fontAt = () => page.locator("table.grid td").nth(2).evaluate((e) => e.getBoundingClientRect().height);
const h100 = await fontAt();
await page.getByRole("button", { name: "Zoom in" }).click();
await page.getByRole("button", { name: "Zoom in" }).click();
const h125 = await fontAt();
check("Zoom in twice: 125 %, rows taller, no sideways scrolling", (await page.locator(".sb-pct").innerText()) === "125%" && h125 > h100 * 1.15 && !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${h100.toFixed(1)} → ${h125.toFixed(1)} px`);
await page.reload();
await page.waitForSelector(".excalidraw");
await tab(/^Materials/);
check("the zoom is remembered", (await page.locator(".sb-pct").innerText()) === "125%");
await page.locator(".sb-pct").click();
check("clicking the percentage goes back to 100 %", (await page.locator(".sb-pct").innerText()) === "100%");
await tab(/^PFD/);
check("the PFD has no status bar zoom (the drawing has its own)", (await page.locator(".sb-zoom").count()) === 0);

// ---- one-line ribbon ------------------------------------------------------------------------------------------------
const full = await page.locator(".ribbon").evaluate((e) => e.getBoundingClientRect().height);
await page.getByRole("button", { name: "Show a one-line ribbon" }).click();
const one = await page.locator(".ribbon").evaluate((e) => e.getBoundingClientRect().height);
check("one-line ribbon: lower, all buttons still there", one < full * 0.6 && (await page.getByRole("button", { name: "Save to file" }).isVisible()) && (await page.getByRole("button", { name: "Export to PowerPoint…" }).isVisible()), `${full} → ${one} px`);
await page.reload();
await page.waitForSelector(".excalidraw");
check("the one-line ribbon is remembered", await page.locator(".ribbon.compact").isVisible());
if (shot) await page.screenshot({ path: `${shot}-compact.png` });
await page.getByRole("button", { name: "Show the full ribbon" }).click();

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
