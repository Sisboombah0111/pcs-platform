// Browser test of N5.4 (one-line rows, as in Excel): BOM lines one row high with the extra text run on in the same
// line, a corner mark when there is something to read (all of it in the tooltip and the formula bar), the Batches
// column, "+ Backup" that takes no room; Operations streams and actions as drop-down cells (click, Alt+↓ or F2 opens
// the list with the same editors, Esc or a click elsewhere closes it, the list opens upwards near the bottom).
// Usage: LANG=C.UTF-8 node tools/smoke-n54.mjs <base-url> [screenshot-prefix]
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
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); for (const k of Object.keys(localStorage)) if (k.startsWith("pcs.ops.") || k.startsWith("pcs.bom.")) localStorage.removeItem(k); } catch { /* storage off */ } });
await page.goto(base);
await page.waitForSelector(".excalidraw");
await page.getByRole("button", { name: /^Open the example/ }).click();
const d = page.getByRole("button", { name: "Open without saving" });
if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
await page.waitForTimeout(2000);
const wait = (ms) => page.waitForTimeout(ms);
const screen = async (re) => { await page.getByRole("tab", { name: re }).first().click(); await wait(600); };
const sheet = async (re) => { await page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: re }).click(); await wait(300); };
const fbar = async () => (await page.locator(".xl-fbar").innerText()).replace(/\s+/g, " ").trim();

// ---- BOM: one line per row ----------------------------------------------------------------------------------------
await screen(/^BOM/);
await sheet(/^PROA/);
const proa = page.locator("section[aria-label='BOM PROA']");
const heights = await proa.locator("tbody tr:not(.bom-sub)").evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
check("BOM lines one row high (≤ 40 px each)", heights.length >= 8 && Math.max(...heights) <= 40, JSON.stringify(heights));
const subs = await proa.locator("tbody tr.bom-sub").evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
check("recipe and backup rows one row high too", subs.length > 0 && Math.max(...subs) <= 40, JSON.stringify(subs));
const heads = await proa.locator("thead tr:last-child th").allInnerTexts();
check("a Batches column (the project has batch recipes)", heads.some((h) => /^Batches/.test(h.trim())), JSON.stringify(heads));
const bag = proa.locator("tbody tr:not(.bom-sub)", { hasText: "BUF-1001-B" }).first();
check("Batches: 10 / 0 × 200 L, the tooltip says it in full", (await bag.locator(".bom-batches").innerText()) === "10 / 0 × 200 L" && (await bag.locator(".bom-batches").getAttribute("title")) === "Batches of 200 L: Sending 10 · Receiving 0");
const mat = bag.locator("td.bom-mat");
const matTitle = await mat.getAttribute("title");
check("the material cell: its whole text in the tooltip (name, prepared, batches)", /\n/.test(matTitle) && /Prepared in-house/.test(matTitle) && /Batches of 200 L/.test(matTitle), matTitle);
check("the cell is cut at its edge, not wrapped", (await mat.evaluate((td) => getComputedStyle(td).whiteSpace)) === "nowrap");
await mat.click({ position: { x: 20, y: 10 } });
await wait(200);
check("click it: the formula bar shows all of it", /Prepared in-house \(recipe below\) · Batches of 200 L/.test(await fbar()), await fbar());

// A corner mark where there is something to read: an issue, a change since a revision, or a note. A manual source
// without a reason is an issue.
check("no marks while there is nothing to read", (await page.locator(".xl-sheet td.bom-mat.mark").count()) === 0);
const row2 = proa.locator("tbody tr:not(.bom-sub)").nth(1);
const code2 = (await row2.locator("td").first().innerText()).trim();
await page.getByLabel(`Source of ${code2}`).selectOption("manual");
await wait(300);
const issueCell = row2.locator("td.bom-mat");
check("manual without a reason: an issue mark, the issue in the tooltip, the row still one line", (await issueCell.getAttribute("class")).includes("mark-issue") && /Give a reason for the manual quantity/.test(await issueCell.getAttribute("title")) && (await row2.evaluate((r) => r.getBoundingClientRect().height)) <= 40, await issueCell.getAttribute("title"));
const marks = await page.locator(".xl-sheet td.bom-mat.mark").evaluateAll((tds) => tds.map((td) => [[...td.classList].find((c) => c.startsWith("mark-")), td.getAttribute("title")?.split("\n").length ?? 0, getComputedStyle(td, "::after").borderRightWidth]));
check("marked cells have more to read and a corner triangle", marks.length > 0 && marks.every(([k, n, w]) => k && n >= 2 && w === "9px"), JSON.stringify(marks.slice(0, 4)));
if (shot) await page.screenshot({ path: `${shot}-bom-mark.png` });
await row2.getByRole("button", { name: "Reset" }).click();
await wait(300);
check("Reset: back to the automatic source, the mark goes", !(await issueCell.getAttribute("class")).includes("mark"));

// "+ Backup": no room in the line, shown on hover.
const firstRow = proa.locator("tbody tr:not(.bom-sub)").filter({ has: page.locator(".small-link:not(.has)") }).first();
const link = firstRow.locator(".small-link:not(.has)");
await page.mouse.move(5, 5);
await wait(250);
const before = await link.evaluate((el) => [getComputedStyle(el).opacity, getComputedStyle(el).position]);
await firstRow.locator("td").nth(2).hover();
await wait(250);
const after = await link.evaluate((el) => getComputedStyle(el).opacity);
check("+ Backup takes no room and shows on hover", before[0] === "0" && before[1] === "absolute" && after === "1", JSON.stringify([before, after]));
if (shot) await page.screenshot({ path: `${shot}-bom.png` });
await page.locator(".xl-namebox").click();

// ---- Operations: drop-down cells -------------------------------------------------------------------------------------
await screen(/^Operations/);
const row3 = page.locator("tr[data-step='3']");
const opHeights = await page.locator("table.ops-steps tbody tr").evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
check("steps one row high (≤ 40 px)", opHeights.length === 14 && Math.max(...opHeights) <= 40, JSON.stringify(opHeights));
const nameW = await page.locator("table.ops-steps thead tr:last-child th").nth(1).evaluate((th) => Math.round(th.getBoundingClientRect().width));
const tableFits = await page.locator("table.ops-steps").evaluate((t) => t.scrollWidth <= t.closest(".xl-sheet").clientWidth + 1);
check("a long streams text does not squeeze the step names; the table fits a 1366 px window", nameW >= 150 && tableFits, `Step column ${nameW} px`);
const streamsBtn = page.getByRole("button", { name: "Streams of step 3", exact: true });
check("streams read as one line: ID, name and MB value", /^ST-PROA-001 HCCF load · 1,900 L, ST-PROA-006 Column waste · 5,500 L$/.test((await streamsBtn.innerText()).trim()), await streamsBtn.innerText());
const actionsBtn = page.getByRole("button", { name: "Actions of step 3", exact: true });
check("actions read as one line, an open valve in green", (await actionsBtn.innerText()).trim() === "Close XV-102; Open XV-101" && (await actionsBtn.locator(".op-on").innerText()) === "Open XV-101");
check("closed: no list, aria-expanded false", (await page.locator(".cell-pop").count()) === 0 && (await streamsBtn.getAttribute("aria-expanded")) === "false");
await streamsBtn.click();
await wait(150);
const pop = page.getByRole("dialog", { name: "Streams of step 3" });
check("click: the list opens below with the chips and + Stream", await pop.isVisible() && (await pop.locator(".op-chip.stream").count()) === 2 && await page.getByLabel("Add a stream to step 3").isVisible() && (await streamsBtn.getAttribute("aria-expanded")) === "true");
if (shot) await page.screenshot({ path: `${shot}-ops-streams.png` });
await page.keyboard.press("Escape");
await wait(100);
check("Esc closes it, the cell's button keeps the focus", (await page.locator(".cell-pop").count()) === 0 && await streamsBtn.evaluate((el) => el === document.activeElement));
// Select the cell with the keyboard, then Alt+↓ opens its list (as Excel's drop-down cell).
await row3.locator("td").nth(3).click();
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press("ArrowRight");
await wait(100);
check("arrow keys reach the streams cell", await row3.locator("td.op-dd-cell").first().evaluate((td) => td.classList.contains("cell-cur")));
await page.keyboard.press("Alt+ArrowDown");
await wait(150);
check("Alt+↓ opens the list of the selected cell", await pop.isVisible());
await page.locator(".xl-namebox").click();
await wait(100);
check("a click elsewhere closes it", (await page.locator(".cell-pop").count()) === 0);
await row3.locator("td").nth(3).click();
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("F2");
await wait(150);
const apop = page.getByRole("dialog", { name: "Actions of step 3" });
check("F2 on the actions cell opens its list", await apop.isVisible() && (await apop.locator(".op-chip.act").count()) === 2);
await page.getByLabel("Add an action to step 3").selectOption("__new");
await wait(150);
await page.getByLabel("New tag for step 3").fill("XV-9");
await page.getByLabel("New tag for step 3").press("Escape");
await wait(100);
check("Esc in the new-tag field cancels the tag only, the list stays open", await apop.isVisible() && await page.getByLabel("Add an action to step 3").isVisible());
await page.keyboard.press("Escape");
await wait(100);
// The last step: the list opens upwards when there is no room below.
const last = page.getByRole("button", { name: "Actions of step 14", exact: true });
await last.scrollIntoViewIfNeeded();
await last.click();
await wait(200);
const lp = page.getByRole("dialog", { name: "Actions of step 14" });
const [cellBox, popBox, sheetBox] = [await last.boundingBox(), await lp.boundingBox(), await page.locator(".xl-sheet").boundingBox()];
check("near the bottom the list opens upwards and stays in the sheet", popBox.y + popBox.height <= cellBox.y + 2 && popBox.y >= sheetBox.y - 1, JSON.stringify([cellBox, popBox, sheetBox].map((b) => [Math.round(b.y), Math.round(b.height)])));
if (shot) await page.screenshot({ path: `${shot}-ops-up.png` });
await page.keyboard.press("Escape");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
