// Browser test of the in-app guide and of batches (rounding up per preparation):
//   guide   opens on a first visit with step 1 next, closes and stays closed, English / 한국어 remembered,
//           all seven steps done on the downstream example, buttons go to the right screen, "This screen"
//           follows the screen on view
//   batches the downstream example prepares BUF-1001 in 200 L bags (Sending) or 2,000 L tank batches
//           (Receiving): 10 bags and 8 filters, in the BOM, the totals and the Excel file; the recipe dialog
//           shows the batches as you type and a new batch size changes the BOM
// Usage: LANG=C.UTF-8 node tools/smoke-guide.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const ExcelJS = require("exceljs");

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true, locale: "en-US" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const text = (sel) => page.locator(sel).innerText();
const guide = page.locator("aside.guide");
const steps = () => page.locator(".guide-step").evaluateAll((els) => els.map((e) => [e.dataset.step, [...e.classList].filter((c) => ["done", "todo", "check", "wait", "next"].includes(c)).join(" ")]));
const readXlsx = async (dl) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(await dl.path()); return wb; };

await page.goto(base);
await page.waitForSelector(".excalidraw");
await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } });
await page.reload();
await page.waitForSelector(".excalidraw");
await wait(600);

// ---- guide on a first visit -----------------------------------------------------------------------------------
check("first visit: the guide is open, in English (browser language)", await guide.isVisible() && /Linking steps/.test(await text("aside.guide")));
let s = await steps();
check("seven steps; materials is next, later steps wait", s.length === 7 && s[0][1] === "todo next" && s[2][1] === "wait" && s[6][1] === "wait", JSON.stringify(s));
check("the next step is open with its how-to and a button", /Import Excel\/CSV/.test(await text(".guide-step.next")) && await page.locator(".guide-step.next button.primary", { hasText: "Open Materials" }).isVisible());
if (shot) await page.screenshot({ path: `${shot}-first-visit.png` });
await page.getByRole("button", { name: "Close the guide" }).click();
await page.reload();
await page.waitForSelector(".excalidraw");
await wait(400);
check("closed: stays closed after a reload", !(await guide.isVisible()));
await page.locator(".guide-btn").click();
await page.locator(".guide .seg button", { hasText: "한국어" }).click();
check("한국어: the steps in Korean", /연동 절차/.test(await text("aside.guide")) && /자재 목록 만들기/.test(await text("aside.guide")));
await page.reload();
await page.waitForSelector(".excalidraw");
await wait(400);
check("open and Korean are remembered", await guide.isVisible() && /자재 목록 만들기/.test(await text("aside.guide")));
await page.locator(".guide .seg button", { hasText: "EN" }).click();

// ---- the downstream example: every step done ------------------------------------------------------------------
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(resolve("examples/example-downstream.pcs.json"));
  await wait(2000);
}
s = await steps();
check("downstream example: 7 of 7 done", s.every(([, st]) => st === "done") && /7 of 7 done/.test(await text(".guide-progress")), JSON.stringify(s));
check("what each step found", /43 materials, 14 with a recipe \(2 in batches\)/.test(await text("aside.guide")) && /37 streams in 7 unit operations \(STOR: transfers only\)/.test(await text("aside.guide")));
// Buttons go to the right place.
const openStep = async (id) => { const li = page.locator(`.guide-step[data-step='${id}']`); if (!/\bopen\b/.test(await li.getAttribute("class"))) await li.locator(".guide-step-head").click(); return li; };
await (await openStep("bom")).locator("button.primary").click();
await wait(500);
check("“Open BOM” shows the BOM", await page.getByRole("tab", { name: "BOM", exact: true }).getAttribute("aria-selected") === "true");
await page.locator(".guide-tab", { hasText: "This screen" }).click();
check("“This screen” follows the screen on view (BOM)", /one per unit operation, Totals/.test(await text(".guide-screen")));
await page.locator(".guide-tab", { hasText: "Linking steps" }).click();
await (await openStep("map")).locator("button.primary").click();
await wait(700);
check("“Open the process map” shows the PFD on the process map", await page.getByRole("tab", { name: "PFD", exact: true }).getAttribute("aria-selected") === "true"
  && await page.locator(".sheet-tab.map").getAttribute("aria-selected") === "true");
await (await openStep("linked")).locator("button.primary").click();
await wait(300);
check("“Open the link check” opens it", /Everything lines up/.test(await text(".dialog")));
await page.getByRole("button", { name: "Close", exact: true }).click();
await page.locator(".guide-tab", { hasText: "Rules" }).click();
check("Rules: batches rounded up", /⌈line quantity ÷ batch size⌉/.test(await text(".guide-rules")));
await page.locator(".guide-tab", { hasText: "Linking steps" }).click();
await page.getByRole("button", { name: "Close the guide" }).click();

// ---- batches: bags and tank filters ------------------------------------------------------------------------------
await page.getByRole("tab", { name: "BOM", exact: true }).click();
await wait(700);
// N5.4: the Batches column shows "10 / 0 × 200 L"; its tooltip says it in full.
const lineNote = async (code) => { const b = page.locator(`section[aria-label='BOM PROA'] tbody tr:not(.bom-sub)`, { hasText: code }).first().locator(".bom-batches"); return `${await b.innerText()} | ${await b.getAttribute("title")}`; };
check("BOM: BUF-1001-B in 200 L bags, 10 batches at Sending", (await lineNote("BUF-1001-B")) === "10 / 0 × 200 L | Batches of 200 L: Sending 10 · Receiving 0", await lineNote("BUF-1001-B"));
check("BOM: BUF-1001-T in 2,000 L tank batches, 8 at Receiving", (await lineNote("BUF-1001-T")) === "0 / 8 × 2,000 L | Batches of 2,000 L: Sending 0 · Receiving 8", await lineNote("BUF-1001-T"));
const part = async (parent, code) => page.evaluate(([parent, code]) => {
  const rows = [...document.querySelectorAll("section[aria-label='BOM PROA'] tbody tr")];
  const i = rows.findIndex((r) => !r.classList.contains("bom-sub") && r.children[0].innerText.trim() === parent);
  const p = rows.slice(i + 1).find((r) => r.classList.contains("bom-part") && r.children[0].innerText.includes(code));
  return p ? [p.children[1].innerText.replace(/\s+/g, " ").trim(), p.children[7].innerText.trim(), p.children[8].innerText.trim()] : null;
}, [parent, code]);
const bag = await part("BUF-1001-B", "CON-0004");
check("bag row: 1 EA per batch of 200 L, 10 / 0", bag && /1 EA per batch of 200 L/.test(bag[0]) && bag[1] === "10" && bag[2] === "0", JSON.stringify(bag));
const flt = await part("BUF-1001-T", "FLT-0007");
check("filter row: 1 EA per batch of 2,000 L, 0 / 8", flt && /1 EA per batch of 2,000 L/.test(flt[0]) && flt[1] === "0" && flt[2] === "8", JSON.stringify(flt));
const totals = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("section[aria-label='Totals'] tbody tr")].map((tr) => { const td = [...tr.children].map((c) => c.innerText.trim()); return [td[0], [td[4], td[5]]]; })));
check("totals buy 10 bags and 8 filters", JSON.stringify(totals["CON-0004"]) === '["10","0"]' && JSON.stringify(totals["FLT-0007"]) === '["0","8"]', JSON.stringify([totals["CON-0004"], totals["FLT-0007"]]));
const prepared = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("section[aria-label='Prepared in-house'] tbody tr")].map((tr) => { const td = [...tr.children].map((c) => c.innerText.trim()); return [td[0], td[6]]; })));
check("prepared in-house shows the batches", prepared["BUF-1001-B"] === "10 / 0 × 200 L" && prepared["BUF-1001-T"] === "0 / 8 × 2,000 L", JSON.stringify([prepared["BUF-1001-B"], prepared["BUF-1001-T"]]));
if (shot) await page.screenshot({ path: `${shot}-bom.png` });
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).first().click()]);
  const wb = await readXlsx(dl);
  const prep = wb.getWorksheet("Prepared");
  const head = prep.getRow(1).values.slice(1);
  const rowB = []; prep.eachRow((r, i) => { if (i > 1 && r.values[1] === "BUF-1001-B") rowB.push(...r.values.slice(1)); });
  const bi = head.indexOf("Batch size");
  check("Excel Prepared sheet: batch size and batches per scenario", bi > 0 && head[bi + 1] === "Sending batches" && rowB[bi] === 200 && rowB[bi + 1] === 10 && rowB[bi + 2] === 0, JSON.stringify([head.slice(bi), rowB.slice(bi)]));
  const about = []; wb.getWorksheet("About").eachRow((r) => about.push(r.values.slice(1).join(" ")));
  check("Excel About sheet explains batches", about.some((x) => /^Batches .*rounded up/.test(x)));
}

// ---- the recipe dialog: batches as you type, a new batch size changes the BOM ------------------------------------
await page.getByRole("tab", { name: /^Materials/ }).click();
await wait(500);
await page.getByLabel("Recipe of BUF-1001-B").click();
await wait(300);
const tryText = () => text(".recipe-try");
check("recipe dialog: batch size 200, the bag per batch, try 1980 L → 10 batches, 10 bags", await page.getByLabel("Batch size").inputValue() === "200"
  && await page.getByLabel("Counted 2").inputValue() === "batch" && /10 batches of 200 L/.test(await tryText()) && /CON-0004 10 EA \(10 × 1\)/.test(await tryText()), (await tryText()).replace(/\n/g, " | "));
if (shot) await page.locator(".dialog").screenshot({ path: `${shot}-recipe.png` });
await page.getByLabel("Batch size").fill("100");
await wait(200);
check("try it follows the batch size (100 L → 20 batches)", /20 batches of 100 L/.test(await tryText()));
await page.getByLabel("Make every batch in full").check();
await page.getByLabel("Try quantity").fill("1950");
await wait(200);
check("whole batches: 1,950 L → 20 batches, BUF-1001 for 2,000 L", /20 batches/.test(await tryText()) && /BUF-1001 2,000 L/.test(await tryText()), (await tryText()).replace(/\n/g, " | "));
await page.getByLabel("Make every batch in full").uncheck();
await page.getByRole("button", { name: "Save recipe" }).click();
await wait(400);
check("Materials shows the batch size on the recipe button", (await page.getByLabel("Recipe of BUF-1001-B").innerText()) === "Recipe (2) · 100 L");
await page.getByRole("tab", { name: "BOM", exact: true }).click();
await wait(600);
check("BOM after the change: 1,980 L in 100 L bags = 20 bags", (await lineNote("BUF-1001-B")) === "20 / 0 × 100 L | Batches of 100 L: Sending 20 · Receiving 0" && (await part("BUF-1001-B", "CON-0004"))?.[1] === "20");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
