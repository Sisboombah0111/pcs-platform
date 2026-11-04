// Browser test of N4.10 (BOM that keeps changing): search, filters and folded sections on the BOM;
// revisions (save, marks on changed lines, compare, Excel with the changes, saved in the project file,
// delete); Where used from the BOM and from Materials, with the jumps to the BOM, the PFD and a recipe.
// Usage: LANG=C.UTF-8 node tools/smoke-revisions.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
const bomTab = async () => { await page.getByRole("tab", { name: "BOM", exact: true }).click(); await wait(700); };
const sections = () => page.locator("section[aria-label^='BOM ']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").slice(4)));
const line = (uo, code) => page.locator(`tr[data-bom-line='${uo}|${code}']`);
const readXlsx = async (dl) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(await dl.path()); return wb; };

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForSelector(".excalidraw");
await page.evaluate(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith("pcs.bom.")) localStorage.removeItem(k); } catch { /* */ } });
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(resolve("examples/example-downstream.pcs.json"));
  await wait(2000);
}

// ---- find: search, category, fold ---------------------------------------------------------------------------------
await bomTab();
check("no revision yet: the hint says how to start", /No revision yet/.test(await text(".bom-tools")) && /Revisions \(0\)/.test(await text(".page-head")));
await page.getByLabel("Search the BOM").fill("sodium chloride");
await wait(300);
let s = await sections();
check("search finds lines whose recipe has sodium chloride, sections without any are hidden", /of 42 lines/.test(await text(".bom-tools")) && s.includes("PROA") && s.includes("CEX") && !s.includes("FILL") && !s.includes("STOR"), JSON.stringify(s));
await page.getByLabel("Search the BOM").fill("");
await page.getByLabel("Category").selectOption("Filter");
await wait(300);
s = await sections();
check("category Filter: lines of filters (and buffers whose recipe has one)", s.includes("PROA") && s.includes("VF") && await line("PROA", "FLT-0001").isVisible() && !(await line("PROA", "BUF-1002").isVisible()), JSON.stringify(s));
await page.getByRole("button", { name: "Clear", exact: true }).click();
await page.getByRole("button", { name: "Fold PROA" }).click();
await wait(200);
check("fold a section: its lines are hidden", !(await line("PROA", "BUF-1002").isVisible()) && await line("CEX", "BUF-2001").isVisible());
await page.reload();
await page.waitForSelector(".excalidraw");
await bomTab();
check("folded sections are remembered", !(await line("PROA", "BUF-1002").isVisible()));
await page.getByRole("button", { name: "Unfold all" }).click();

// ---- revisions -------------------------------------------------------------------------------------------------------
await page.getByRole("button", { name: "Save revision…" }).click();
await wait(200);
check("save dialog proposes Rev A", await page.getByLabel("Revision label").inputValue() === "Rev A");
await page.getByLabel("Revision note").fill("Sent to purchasing");
await page.getByLabel("Your name").fill("Kim");
await page.getByRole("button", { name: "Save revision", exact: true }).click();
await wait(500);
check("saved: Revisions (1), no line changed since Rev A", /Revisions \(1\)/.test(await text(".page-head")) && /No line changed since Rev A/.test(await text(".bom-tools")));
const ov = page.getByLabel("Overage of BUF-1002");
await ov.click(); await ov.fill("10"); await ov.press("Enter");
await page.getByLabel("Source of BUF-2003").selectOption("excluded");
await wait(500);
check("a changed line is marked: ▲ +90 / +660 since Rev A", /▲ \+90 \/ \+660 since Rev A/.test(await line("PROA", "BUF-1002").innerText()));
check("a line not counted any more says what it was", /Not counted since Rev A \(was 450 \/ 3,600\)/.test(await line("CEX", "BUF-2003").innerText()));
check("section and summary count the changes", /1 changed since Rev A/.test(await text("section[aria-label='BOM PROA'] .section-head")) && /0 added · 1 removed · 1 changed since Rev A/.test(await text(".bom-tools")));
await page.getByLabel(/Changed since Rev A/).check();
await wait(300);
check("filter “Changed since Rev A”: only PROA and CEX are left", JSON.stringify(await sections()) === '["PROA","CEX"]' && /2 of 42 lines/.test(await text(".bom-tools")), JSON.stringify(await sections()));
await page.getByLabel(/Changed since Rev A/).uncheck();
await page.locator(".bom-tools .linkish").click();
await wait(300);
let dlg = await text(".dialog");
check("compare (totals): the buffers and the NaCl from them", /Rev A → Now/.test(dlg) && /1 removed/.test(dlg) && /1 changed/.test(dlg) && /CHM-0002/.test(dlg) && /900 → 990 \(\+90\)/.test(dlg));
await page.getByRole("button", { name: "Lines per unit operation" }).click();
dlg = await text(".dialog");
check("compare (lines): BUF-2003 in CEX removed, BUF-1002 in PROA changed", /Removed\s+CEX\s+BUF-2003/.test(dlg) && /Changed\s+PROA\s+BUF-1002/.test(dlg), dlg.slice(0, 300).replace(/\n/g, " | "));
if (shot) await page.locator(".dialog").screenshot({ path: `${shot}-compare.png` });
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).last().click()]);
  const wb = await readXlsx(dl);
  check("compare export: the two change sheets", dl.suggestedFilename().includes("Rev A vs Now") && !!wb.getWorksheet("Changes (lines)") && wb.getWorksheet("Changes (lines)").rowCount === 3, `${dl.suggestedFilename()} ${wb.getWorksheet("Changes (lines)")?.rowCount}`);
}
await page.getByRole("button", { name: "Close", exact: true }).click();
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).first().click()]);
  const wb = await readXlsx(dl);
  const about = []; wb.getWorksheet("About").eachRow((r) => about.push(r.values.slice(1).join(" ")));
  check("BOM export: dated file name after Rev A, About says what changed, the Changes sheets", /BOM after Rev A \d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename())
    && about.some((x) => /^Changes since Rev A .*1 removed, 1 changed/.test(x)) && about.some((x) => /^Revisions Rev A/.test(x)) && !!wb.getWorksheet("Changes (totals)"), dl.suggestedFilename());
}
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
  const json = JSON.parse(readFileSync(await dl.path(), "utf8"));
  check("the revision is saved in the project file", json.bom.revisions?.length === 1 && json.bom.revisions[0].label === "Rev A" && json.bom.revisions[0].note === "Sent to purchasing" && json.bom.revisions[0].createdBy === "Kim");
}

// ---- Where used --------------------------------------------------------------------------------------------------------
await page.locator("tr[data-bom-line='PROA|BUF-1001-B']").locator("xpath=following-sibling::tr").filter({ hasText: "CHM-0002" }).first().locator(".code-link").click();
await wait(300);
dlg = await text(".dialog");
check("Where used from a recipe row (CHM-0002): five recipes, a backup", /In recipes\s*5/.test(dlg) && /BUF-1001\b/.test(dlg) && /Its backup CHM-0102/.test(dlg), dlg.slice(0, 200).replace(/\n/g, " | "));
if (shot) await page.locator(".dialog").screenshot({ path: `${shot}-where-used.png` });
await page.locator(".wu-section[aria-label='In recipes'] li", { hasText: "BUF-1003" }).count().then((n) => check("…not in recipes without it (BUF-1003)", n === 0));
await page.locator(".wu-section[aria-label='In recipes'] li", { hasText: "BUF-1001 " }).first().getByRole("button", { name: "Open recipe" }).click();
await wait(600);
check("“Open recipe” opens the recipe of BUF-1001 on Materials", await page.getByRole("tab", { name: /^Materials/ }).getAttribute("aria-selected") === "true" && /Recipe · BUF-1001 /.test(await text(".dialog")));
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByLabel("Where is FLT-0001 used").click();
await wait(300);
dlg = await text(".dialog");
check("Materials › Used: FLT-0001 in the BOM of PROA and the MB row ST-PROA-010", /BOM lines\s*1/.test(dlg) && /ST-PROA-010/.test(dlg));
await page.locator(".wu-section[aria-label='Mass balance (PCS_LINK rows)']").getByRole("button", { name: "Show on PFD" }).click();
await wait(1200);
const sel = await page.evaluate(() => { const api = window.__pcsPfd.api; const ids = Object.keys(api.getAppState().selectedElementIds); return api.getSceneElements().filter((e) => ids.includes(e.id)).map((e) => e.customData?.pcs?.streamId).filter(Boolean); });
check("“Show on PFD” opens the PROA drawing with ST-PROA-010 selected", await page.getByRole("tab", { name: "PFD", exact: true }).getAttribute("aria-selected") === "true" && sel.includes("ST-PROA-010"), JSON.stringify(sel));
await bomTab();
await page.getByLabel("Search the BOM").fill("nothing like this");
await page.getByRole("tab", { name: /^Materials/ }).click();
await wait(400);
await page.getByLabel("Where is FLT-0001 used").click();
await page.locator(".wu-section[aria-label='BOM lines']").getByRole("button", { name: "Open in BOM" }).click();
await wait(900);
check("“Open in BOM” clears the filters and shows the line", await line("PROA", "FLT-0001").isVisible() && (await page.getByLabel("Search the BOM").inputValue()) === "");

// ---- delete the revision -------------------------------------------------------------------------------------------
await page.getByRole("button", { name: "Revisions (1)" }).click();
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.getByRole("button", { name: "Delete revision" }).click();
await wait(300);
await page.getByRole("button", { name: "Close", exact: true }).click();
await wait(300);
check("revision deleted: no marks, no revisions", /Revisions \(0\)/.test(await text(".page-head")) && !/since Rev A/.test(await line("PROA", "BUF-1002").innerText()));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
