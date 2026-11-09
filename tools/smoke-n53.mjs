// Browser test of N5.3 (Materials, BOM and Operations as Excel workbooks): sheets at the bottom, column letters and
// row numbers on every table, the formula bar (the whole text of a cell, and editing a text cell from it), the
// filters in the ribbon, and that switching sheets shows the right tables.
// Usage: LANG=C.UTF-8 node tools/smoke-n53.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const errors = [];
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
await page.goto(base);
await page.waitForSelector(".excalidraw");
await page.getByRole("button", { name: /^Open the example/ }).click();
const d = page.getByRole("button", { name: "Open without saving" });
if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
await page.waitForTimeout(2000);
const screen = async (re) => { await page.getByRole("tab", { name: re }).first().click(); await page.waitForTimeout(600); };
const sheets = () => page.getByRole("tablist", { name: "Sheets" }).getByRole("tab").allInnerTexts();
const sheet = async (re) => { await page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: re }).click(); await page.waitForTimeout(300); };
const fbar = async () => (await page.locator(".xl-fbar").innerText()).replace(/\s+/g, " ").trim();
const visibleRows = (sel) => page.locator(sel).evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);

// ---- Materials -----------------------------------------------------------------------------------------------------
await screen(/^Materials/);
check("Materials sheets: Material list, Recipes, Backups", JSON.stringify(await sheets()) === JSON.stringify(["Material list (43)", "Recipes (14)", "Backups (4)"]), JSON.stringify(await sheets()));
const head = page.locator(".xl-sheet table.grid thead tr:last-child th");
check("column letters: Code is A, Name is B (the select column has none)", (await head.nth(1).getAttribute("data-col")) === "A" && (await head.nth(2).getAttribute("data-col")) === "B" && (await head.nth(0).getAttribute("data-col")) === null);
check("row numbers: header row 1, first material row 2", (await head.nth(0).getAttribute("data-rn")) === "1" && (await page.locator(".xl-sheet table.grid tbody tr").first().locator("td").first().getAttribute("data-rn")) === "2");
const name3 = page.locator("tr[data-code='CHM-0003'] input[aria-label='Name']");
await name3.click();
check("click a name: the formula bar shows B4 and the whole name", /^B4 fx/.test(await fbar()) && (await page.getByLabel("Contents of the cell").inputValue()) === "Acetic acid, glacial", await fbar());
const fx = page.getByLabel("Contents of the cell");
await fx.click();
await fx.fill("Acetic acid, glacial 100 %");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
check("typed in the formula bar, the cell changes", (await name3.inputValue()) === "Acetic acid, glacial 100 %");
await page.locator("body").click({ position: { x: 600, y: 200 } });
await page.keyboard.press("Control+z");
await page.waitForTimeout(300);
check("Ctrl+Z takes it back", (await name3.inputValue()) === "Acetic acid, glacial", await name3.inputValue());
await page.getByLabel("Search materials").fill("sodium");
await page.waitForTimeout(200);
check("Find in the ribbon filters the sheet, the tab bar says how many", (await visibleRows(".xl-sheet table.grid tbody tr")) < 43 && /of 43 materials shown/.test(await page.locator(".xl-info").innerText()), await page.locator(".xl-info").innerText());
await page.getByLabel("Search materials").fill("");
await sheet(/^Recipes/);
check("Recipes sheet: the recipes as the Excel export has them", (await visibleRows(".xl-sheet table.grid tbody tr")) >= 14 && await page.getByRole("button", { name: "BUF-1001: edit its recipe" }).isVisible());
await page.getByRole("button", { name: "BUF-1001: edit its recipe" }).click();
check("Edit… opens the recipe", await page.locator(".dialog").isVisible());
await page.keyboard.press("Escape");
if (shot) await page.screenshot({ path: `${shot}-recipes.png` });
await sheet(/^Material list/);

// ---- BOM -----------------------------------------------------------------------------------------------------------
await screen(/^BOM/);
const bomSheets = await sheets();
check("BOM sheets: All, one per unit operation, Totals", bomSheets[0] === "All (42)" && bomSheets.includes("PROA (11)") && bomSheets.includes("STOR (2)") && /^Totals/.test(bomSheets.at(-1)), JSON.stringify(bomSheets));
check("All: every unit operation and the totals", (await page.locator("section[aria-label^='BOM ']").count()) === 7 && await page.locator("section[aria-label='Totals']").isVisible());
await sheet(/^CEX/);
check("CEX sheet: only CEX", (await page.locator("section[aria-label^='BOM ']").count()) === 1 && await page.locator("section[aria-label='BOM CEX']").isVisible() && !(await page.locator("section[aria-label='Totals']").count()));
await sheet(/^Totals/);
check("Totals sheet: totals, made in-house, backups", await page.locator("section[aria-label='Totals']").isVisible() && await page.locator("section[aria-label='Prepared in-house']").isVisible() && !(await page.locator("section[aria-label^='BOM ']").count()));
check("Totals: header row 1 and letters", (await page.locator("section[aria-label='Totals'] thead th").first().getAttribute("data-rn")) === "1" && (await page.locator("section[aria-label='Totals'] thead th").first().getAttribute("data-col")) === "A");
await page.locator("section[aria-label='Totals'] tbody tr").first().locator("td").nth(1).click();
check("click a total: the formula bar names it and shows its text", /^B2 fx Tris base/.test(await fbar()), await fbar());
if (shot) await page.screenshot({ path: `${shot}-bom-totals.png` });
await sheet(/^All/);
await page.getByLabel("Search the BOM").fill("BUF-1001");
await page.waitForTimeout(200);
check("Find in the ribbon: the bar says how many lines match", /lines match the filter/.test(await page.locator(".bom-tools").innerText()), await page.locator(".bom-tools").innerText());
await page.getByLabel("Search the BOM").fill("");
await page.keyboard.press("Control+f");
check("Ctrl+F goes to the ribbon's Find box", await page.getByLabel("Search the BOM").evaluate((el) => el === document.activeElement));
await page.evaluate(() => document.activeElement?.blur?.());

// ---- Operations ----------------------------------------------------------------------------------------------------
await screen(/^Operations/);
const opsSheets = await sheets();
check("Operations sheets: one per unit operation and Equipment", /^PROA \(14\)$/.test(opsSheets[0]) && opsSheets.at(-1) === "Equipment (16)" && opsSheets.length === 8, JSON.stringify(opsSheets));
check("the ribbon has the steps' buttons", await page.getByRole("button", { name: "+ Step" }).isVisible() && await page.getByLabel("Add steps from a template").isVisible());
await page.getByRole("tab", { name: "State table" }).click();
await page.waitForTimeout(300);
check("state table: rows numbered in the gutter", (await page.locator("table.op-states tbody tr").first().locator("th, td").first().getAttribute("data-rn")) === "2");
if (shot) await page.screenshot({ path: `${shot}-ops-state.png` });
await page.getByRole("tab", { name: "Steps & actions" }).click();
await sheet(/^Equipment/);
check("Equipment sheet: the list and its Find box in the ribbon", await page.locator("table.ops-eq").isVisible() && await page.getByLabel("Search equipment").isVisible());

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
