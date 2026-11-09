// Browser test of N4.12 (Operations): the PROA steps of the downstream example (steps, streams with MB values,
// actions, state table), switching cells, typing a value, a new unit operation from a template with a new tag,
// a tag renamed in the equipment list following on the PFD label, a PFD shape tagged and sent to Operations,
// export to Excel and import of an edited States sheet, and the v3 project file.
// Usage: LANG=C.UTF-8 node tools/smoke-operations.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const ExcelJS = require("exceljs");

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); for (const k of Object.keys(localStorage)) if (k.startsWith("pcs.ops.")) localStorage.removeItem(k); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const text = (sel) => page.locator(sel).first().innerText();
const toast = async () => (await page.locator(".toast").last().innerText().catch(() => ""));
const tab = async (name) => { await page.getByRole("tab", { name, exact: true }).click(); await wait(500); };
const cell = (tag, step) => page.getByRole("button", { name: new RegExp(`^${tag} in step ${step}:`) });
const stepRow = (n) => page.locator(`tr[data-step='${n}']`);
// N5.4: a step's streams and actions read as one line; their editors open in a list below the cell.
const openDd = async (name) => { await page.getByRole("button", { name, exact: true }).click(); await wait(150); };
const labels = () => page.evaluate(() => window.__pcsPfd.all().filter((e) => e.type === "text" && !e.isDeleted).map((e) => e.originalText ?? e.text));

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

// ---- the example's PROA steps -------------------------------------------------------------------------------------------
await tab("Operations");
check("Operations opens on PROA with its steps", /PROA · Protein A/.test(await text(".xl-info")) && /14 steps · 8 h 25 min · 37 actions/.test(await text(".xl-info")), await text(".xl-info"));
const load = (await stepRow(3).innerText()).replace(/\n/g, " ");
check("step 3: streams with names and MB value, actions as verbs", /ST-PROA-001\s*HCCF load · 1,900 L/.test(load) && /Close XV-102/.test(load) && /Open XV-101/.test(load), load.slice(0, 200));
if (shot) await page.screenshot({ path: `${shot}-steps.png` });

await page.getByRole("tab", { name: "State table" }).click();
await wait(300);
check("state table: XV-101 opened in step 3, kept in 4? no: closed in 4", (await cell("XV-101", 3).getAttribute("aria-label")) === "XV-101 in step 3: Open (action)" && (await cell("XV-101", 4).getAttribute("aria-label")) === "XV-101 in step 4: Closed (action)" && (await cell("XV-101", 5).getAttribute("aria-label")) === "XV-101 in step 5: Closed");
await cell("XV-110", 2).click();
await wait(300);
check("click on a kept cell: an action (Close XV-110 in step 2), kept Closed after it", /\(action\)$/.test(await cell("XV-110", 2).getAttribute("aria-label")) && (await cell("XV-110", 3).getAttribute("aria-label")) === "XV-110 in step 3: Closed");
await cell("XV-110", 2).click();
await wait(300);
check("click again: back to the state before, the action goes", (await cell("XV-110", 2).getAttribute("aria-label")) === "XV-110 in step 2: Open");
await cell("P-101", 4).dblclick();
await page.getByLabel("P-101 in step 4").fill("50 %");
await page.getByLabel("P-101 in step 4").press("Enter");
await wait(300);
check("double-click: a value (P-101 at 50 % from step 4)", (await cell("P-101", 4).getAttribute("aria-label")) === "P-101 in step 4: 50 % (action)" && (await cell("P-101", 5).getAttribute("aria-label")) === "P-101 in step 5: 50 %");
if (shot) await page.screenshot({ path: `${shot}-table.png` });
await page.getByRole("tab", { name: "Steps & actions" }).click();
await wait(300);
check("the steps list says the same: P-101: 50 % in step 4", /P-101: 50 %/.test(await stepRow(4).innerText()));
await openDd("Actions of step 4");
await stepRow(4).getByRole("button", { name: "Remove P-101: 50 % from step 4" }).click();
await wait(200);

// ---- a new unit operation: template, a stream, a new tag ---------------------------------------------------------------------
await page.locator(".ops-nav-item", { hasText: "CEX" }).click();
await wait(300);
await page.getByLabel("Add steps from a template").selectOption("bindelute");
await wait(400);
check("CEX: 9 steps from the template", /9 steps/.test(await text(".xl-info")));
await openDd("Streams of step 3");
await page.getByLabel("Add a stream to step 3").selectOption("ST-CEX-002");
await openDd("Actions of step 3");
await page.getByLabel("Add an action to step 3").selectOption("__new");
await wait(150);
await page.getByLabel("New tag for step 3").fill("XV-201");
await page.getByRole("button", { name: "Add tag" }).click();
await wait(300);
await page.getByRole("button", { name: "Open XV-201" }).click();
await wait(300);
const cexLoad = (await stepRow(3).innerText()).replace(/\n/g, " ");
check("CEX step 3: ST-CEX-002 with its value, Open XV-201 (a new valve)", /ST-CEX-002\s*CEX load/.test(cexLoad) && /Open XV-201/.test(cexLoad), cexLoad.slice(0, 160));
await page.getByLabel("Add steps from a template").selectOption("vi");
await wait(300);
check("a template adds after the steps already there", /13 steps/.test(await text(".xl-info")));

// ---- the equipment list: rename a tag, the PFD label follows ----------------------------------------------------------------
await page.locator(".ops-nav-item", { hasText: "Equipment" }).click();
await wait(300);
check("equipment list: 17, C-101 drawn on PROA, XV-201 in CEX 3", /17 equipment · 13 on the PFD/.test(await text(".xl-info")) && /PROA drawing/.test(await page.locator("tr", { has: page.locator("input[value='C-101']") }).innerText()) && /CEX 3/.test(await page.locator("tr", { has: page.locator("input[value='XV-201']") }).innerText()));
const tagInput = await page.locator("input[aria-label='Tag'][value='C-101']").elementHandle();
await tagInput.fill("C-1001");
await tagInput.press("Enter");
await wait(400);
await tab("PFD");
await wait(800);
const ls = await labels();
check("renamed tag: the PFD label says C-1001 now", ls.some((t) => t.startsWith("C-1001\n")) && !ls.some((t) => t.startsWith("C-101\n")), JSON.stringify(ls.filter((t) => /^C-1/.test(t))));

// ---- PFD: tag a shape, open it in Operations -----------------------------------------------------------------------------------
await page.locator(".sheet-tab", { hasText: /^\s*PROA\b/ }).first().click();
await wait(1000);
const selectSymbol = (symbol, nth = 0) => page.evaluate(({ symbol, nth }) => {
  const api = window.__pcsPfd.api;
  const els = api.getSceneElements();
  const body = els.filter((e) => e.customData?.pcs?.symbol === symbol)[nth];
  const g = body.groupIds[0];
  const members = els.filter((e) => e.groupIds?.includes(g));
  api.updateScene({ appState: { selectedElementIds: Object.fromEntries(members.map((m) => [m.id, true])), selectedGroupIds: { [g]: true } } });
}, { symbol, nth });
await selectSymbol("bag", 0); // BUF-1001 bag
await wait(400);
await page.getByLabel("Equipment tag").fill("p-101");
await page.getByLabel("Equipment tag").press("Enter");
await wait(500);
check("a tag already in the list (not drawn) links the shape", /Linked to P-101/.test(await toast()) && /In 2 step\(s\)/.test(await text(".eq-field")), await text(".eq-field"));
await selectSymbol("bag", 1);
await wait(400);
await page.getByLabel("Equipment tag").fill("P-101");
await page.getByLabel("Equipment tag").press("Enter");
await wait(500);
check("the same tag on a second shape is refused", /already on another shape/.test(await toast()), await toast());
await selectSymbol("vi");
await wait(400);
check("T-101 shape: its steps in the panel", /T-101/.test(await page.getByLabel("Equipment tag").inputValue()) && /PROA 9 Titrate to pH 3.6: T-101: Add 1 M acetic acid to pH 3.6/.test((await text(".eq-field")).replace(/\n/g, " ")), (await text(".eq-field")).replace(/\n/g, " | "));
if (shot) await page.screenshot({ path: `${shot}-pfd.png` });
await page.getByRole("button", { name: "Show in Operations" }).click();
await wait(700);
check("Show in Operations: the PROA state table with T-101", /PROA ·/.test(await text(".xl-info")) && await page.locator("tr[data-tag='T-101'].flash").count() === 1);

// ---- N4.14: the order of actions in a step, and the step view on the PFD ---------------------------------------------------------
await page.getByRole("tab", { name: "Steps & actions" }).click();
await wait(300);
await openDd("Actions of step 6");
await stepRow(6).getByRole("button", { name: "Move Open XV-104 earlier in step 6" }).click();
await wait(300);
const order = await stepRow(6).locator(".op-chip.act > span:not(.op-chip-sub)").allInnerTexts();
check("an action moved earlier in its step", order.slice(0, 2).join() === "Open XV-104,Close XV-103", order.join(" | "));
await page.getByRole("button", { name: "Show on PFD" }).click();
await wait(1500);
await page.getByLabel("Step", { exact: true }).selectOption("5");
await wait(500);
const badges = await page.locator(".step-badge").allInnerTexts();
const card = (await text(".step-card")).replace(/\n/g, " | ");
check("step view on the PROA drawing: step 6, valves opened now marked, the actions in their order", badges.includes("▶ XV-104 Open") && badges.includes("▶ XV-111 Open") && badges.includes("XV-101 Closed") && /PROA 6 Elute to VI vessel( \| ▾)? \| Open XV-104 \| Close XV-103/.test(card) && await page.locator(".step-flow").count() === 2, `${badges.join(", ")} || ${card.slice(0, 160)}`);
if (shot) await page.screenshot({ path: `${shot}-stepview.png` });
await page.getByRole("button", { name: "Next step" }).click();
await wait(400);
check("next step: 7, XV-110 open again", /PROA 7 Strip and sanitize/.test(await text(".step-card")) && (await page.locator(".step-badge").allInnerTexts()).includes("▶ XV-110 Open"));
await page.getByRole("button", { name: "Close step view" }).click();
await wait(200);
check("step view closed", await page.locator(".step-layer").count() === 0);
await tab("Operations");
await wait(300);

// ---- Excel: export, edit the States sheet, import ------------------------------------------------------------------------------
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).click()]);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(await dl.path());
const names = wb.worksheets.map((w) => w.name);
const st = wb.getWorksheet("States PROA");
const rowOf = (tag) => { let r; st.eachRow((x, i) => { if (x.getCell(1).value === tag) r = i; }); return r; };
const xv101 = st.getRow(rowOf("XV-101")).values.slice(1, 9);
check("export: About, Equipment, Steps, Actions, States PROA and States CEX; XV-101 row", names.join() === "About,Equipment,Steps,Actions,States PROA,States CEX" && xv101.join() === "XV-101,Skid inlet: HCCF load,Closed,Closed,Closed,Open,Closed,Closed", `${names.join()} | ${xv101.join()}`);
st.getRow(rowOf("XV-121")).getCell(4).value = "열림"; // open the WFI valve in step 1 (Korean)
const edited = resolve(tmpdir(), `ops-edited-${process.pid}.xlsx`);
await wb.xlsx.writeFile(edited);
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Import from Excel…" }).click()]);
  await chooser.setFiles(edited);
  await wait(1200);
}
const dlg = (await text(".dialog")).replace(/\n/g, " | ");
// A States cell is the state in that step only: XV-121 opens in step 1 and closes again in step 2 (the next cell says Closed).
check("import preview: PROA from the edited States sheet (2 more actions), CEX 13, no equipment changes", /Equipment: 0 new, 0 changed/.test(dlg) && /PROA: 14 steps, 39 actions \(actions from the States sheet\) · replaces its 14 steps/.test(dlg) && /CEX: 13 steps/.test(dlg) && /States sheet and the Actions sheet say different things/.test(dlg), dlg.slice(0, 400));
await page.locator(".dialog").getByRole("button", { name: "Apply" }).click();
await wait(600);
await page.locator(".ops-nav-item", { hasText: "PROA" }).click();
await page.getByRole("tab", { name: "State table" }).click();
await wait(300);
check("after import: XV-121 open in step 1 only, then as before", (await cell("XV-121", 1).getAttribute("aria-label")) === "XV-121 in step 1: Open (action)" && (await cell("XV-121", 2).getAttribute("aria-label")) === "XV-121 in step 2: Closed (action)" && (await cell("XV-121", 12).getAttribute("aria-label")) === "XV-121 in step 12: Open (action)");

// ---- link check and the project file --------------------------------------------------------------------------------------------
check("link check: still linked", /^Linked/.test((await text(".link-chip")).trim()), await text(".link-chip"));
const [dlp] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
const saved = JSON.parse(readFileSync(await dlp.path(), "utf8"));
const proa = saved.uos.find((u) => u.code === "PROA");
check("project file v3 with equipment and steps", saved.version === 3 && saved.equipment.length === 17 && saved.operations[proa.id].length === 14, `v${saved.version}, ${saved.equipment.length} equipment`);

// ---- delete equipment -------------------------------------------------------------------------------------------------------------
await page.locator(".ops-nav-item", { hasText: "Equipment" }).click();
await page.getByRole("button", { name: "More for XV-201" }).click();
await page.getByRole("menuitem", { name: "Delete XV-201" }).click();
await page.getByRole("button", { name: "Delete equipment" }).click();
await wait(300);
await page.locator(".ops-nav-item", { hasText: "CEX" }).click();
await page.getByRole("tab", { name: "Steps & actions" }).click();
await wait(300);
check("deleted equipment: its action is gone", !/XV-201/.test(await stepRow(3).innerText()));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
