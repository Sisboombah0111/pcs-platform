// Browser test of N4.11 (materials that change): status (obsolete flagged on the BOM and in the link
// check), Replace (from the BOM, with the MB workbook; PFD links follow and the drawing reloads), a code
// change carried into the MB workbook, and revisions that read a code change as a change.
// Usage: LANG=C.UTF-8 node tools/smoke-materials.mjs <base-url> [screenshot-prefix]
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
const tab = async (name) => { await page.getByRole("tab", { name: name === "Materials" ? /^Materials/ : name, exact: name !== "Materials" }).click(); await wait(600); };
const line = (uo, code) => page.locator(`tr[data-bom-line='${uo}|${code}']`);
const row = (code) => page.locator(`tr[data-code='${code}']`);
const chip = () => text(".link-chip");
const toast = async () => (await page.locator(".toast").last().innerText().catch(() => ""));

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
// A revision first, to see later how the changes read.
await tab("BOM");
await page.getByRole("button", { name: "Save revision…" }).click();
await page.getByRole("button", { name: "Save revision", exact: true }).click();
await wait(400);

// ---- status ---------------------------------------------------------------------------------------------------------
await tab("Materials");
await page.getByLabel("Status of FLT-0001").selectOption("obsolete");
await wait(400);
check("obsolete in use: the link check asks to fix it", /Link check: 1 to fix/.test(await chip()), await chip());
await page.getByLabel("Status filter").selectOption("obsolete");
check("status filter shows the obsolete material only", (await page.locator("tr[data-code]").count()) === 1 && await row("FLT-0001").isVisible());
await page.getByLabel("Status filter").selectOption("");
// A new filter that will take its place.
await page.getByRole("button", { name: "Add material" }).click();
await wait(300);
const last = page.locator("tr[data-code]").last();
await last.getByLabel("Code").fill("FLT-0011");
await last.getByLabel("Name").fill("Depth filter capsule (1.6 m²)");
await last.getByLabel("Unit").fill("EA");
await last.getByLabel("Unit").press("Tab");
await tab("BOM");
check("BOM: the obsolete line says so and offers Replace", /FLT-0001 is obsolete/.test(await line("PROA", "FLT-0001").innerText()) && await line("PROA", "FLT-0001").getByRole("button", { name: "Replace FLT-0001…" }).isVisible());

// ---- replace from the BOM, with the MB workbook -------------------------------------------------------------------------
await line("PROA", "FLT-0001").getByRole("button", { name: "Replace FLT-0001…" }).click();
await wait(300);
await page.getByLabel("Replace with").selectOption({ label: "FLT-0011 · Depth filter capsule (1.6 m²) (EA)" });
await wait(200);
let dlg = await text(".dialog");
check("replace dialog: what changes, the MB rows, obsolete by default", /MB: 1 applied row with FLT-0001/.test(dlg) && /Also change FLT-0001 to FLT-0011 in the PCS_LINK sheet of MB_downstream\.xlsx/.test(dlg) && await page.getByLabel(/Mark obsolete/).isChecked(), dlg.replace(/\n/g, " | ").slice(0, 400));
if (shot) await page.locator(".dialog").screenshot({ path: `${shot}-replace.png` });
await page.getByRole("button", { name: "Replace with FLT-0011" }).click();
await wait(1500);
check("replaced: toast says the workbook row changed", /Replaced FLT-0001 with FLT-0011; 1 PCS_LINK row\(s\) changed in the MB workbook\. FLT-0001 is marked obsolete\./.test(await toast()), await toast());
check("BOM: FLT-0011 from the MB (3 / 18), FLT-0001 gone, linked again", await line("PROA", "FLT-0011").isVisible() && /3\s+18/.test((await line("PROA", "FLT-0011").innerText()).replace(/\n/g, " ")) && !(await line("PROA", "FLT-0001").count()) && /^Linked/.test(await chip()), `${await chip()}`);
await tab("Materials");
check("Materials: FLT-0001 obsolete, replaced by FLT-0011", await page.getByLabel("Status of FLT-0001").inputValue() === "obsolete" && /→ FLT-0011/.test(await row("FLT-0001").innerText()));
await tab("Mass Balance");
const hist = await text("section[aria-label='History'] tbody tr:first-child");
check("MB: still applied, History has the app's change", /Applied/.test(await text(".page")) && /This app/.test(hist) && /Replaced FLT-0001 with FLT-0011: FLT-0001 → FLT-0011/.test(hist), hist.replace(/\n/g, " | "));

// ---- a code change, carried into the workbook --------------------------------------------------------------------------
await tab("Materials");
const code = row("BUF-1002").getByLabel("Code");
await code.click();
await code.fill("BUF-1002W");
await page.getByLabel("Search materials").click();
await wait(400);
check("code changed: the bar offers to update the MB workbook; meanwhile the link check says the MB code is unknown", /Code changed: BUF-1002 → BUF-1002W/.test(await text(".page")) && /to fix/.test(await chip()));
if (shot) await page.screenshot({ path: `${shot}-rename.png` });
await page.getByRole("button", { name: "Update the MB workbook too" }).click();
await wait(1500);
check("workbook updated: linked again, the bar is gone", /1 PCS_LINK row\(s\) changed in the MB workbook, 1 applied row\(s\) follow/.test(await toast()) && /^Linked/.test(await chip()) && !/Code changed:/.test(await text(".page")), await toast());
await tab("BOM");
check("BOM: BUF-1002W with its values", /900\s+6,600/.test((await line("PROA", "BUF-1002W").innerText()).replace(/\n/g, " ")));
await page.locator(".bom-tools .linkish").click();
await page.getByRole("button", { name: "Lines per unit operation" }).click();
dlg = await text(".dialog");
check("compare with the revision: the renamed code is a change, the replaced filter one replaced row (N5.6)", /Changed\s+PROA\s+BUF-1002W[\s\S]*code BUF-1002 → BUF-1002W/.test(dlg) && /Replaced\s+PROA\s+FLT-0001 → FLT-0011/.test(dlg) && !/Removed\s+PROA\s+FLT-0001/.test(dlg), dlg.replace(/\n/g, " | ").slice(0, 500));
await page.getByRole("button", { name: "Close", exact: true }).click();

// ---- replace a filter linked on the PFD: links move, the drawing reloads --------------------------------------------------
const f2 = await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] tbody tr")].map((tr) => [...tr.children].map((c) => c.innerText.trim())).filter((t) => ["FLT-0002", "FLT-0006"].includes(t[0])).map((t) => [t[0], t[4], t[5]]));
await tab("Materials");
await page.getByRole("button", { name: "More for FLT-0002" }).click();
await page.getByRole("menuitem", { name: "Replace FLT-0002" }).click();
await page.getByLabel("Replace with").selectOption({ label: 'FLT-0006 · Bulk fill filter 0.2 µm (5") (EA)' });
await page.getByLabel(/Delete it/).check();
dlg = await text(".dialog");
check("replace dialog counts the PFD links", /PFD links: [1-9]\d* shape/.test(dlg), dlg.match(/PFD links: [^\n]*/)?.[0]);
await page.getByRole("button", { name: "Replace with FLT-0006" }).click();
await wait(1800);
check("FLT-0002 deleted", !(await row("FLT-0002").count()));
await tab("BOM");
const f6 = await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] tbody tr")].map((tr) => [...tr.children].map((c) => c.innerText.trim())).find((t) => t[0] === "FLT-0006"));
const sum = (i) => f2.reduce((n, t) => n + Number(t[i]), 0);
check("BOM totals: FLT-0006 = old FLT-0002 + FLT-0006", f6 && Number(f6[4]) === sum(1) && Number(f6[5]) === sum(2), JSON.stringify([f2, f6?.slice(0, 6)]));
await tab("PFD");
await page.locator(".sheet-tab", { hasText: /^\s*CEX\b/ }).first().click();
await wait(1200);
const links = await page.evaluate(() => {
  const api = window.__pcsPfd.api;
  return api.getSceneElements().flatMap((e) => (e.customData?.pcs?.materials ?? []).map((l) => l.materialId));
});
const [dlp] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
const saved = JSON.parse(readFileSync(await dlp.path(), "utf8"));
const idOf = (c) => saved.materials.find((m) => m.code === c)?.id;
check("the CEX drawing on screen links FLT-0006, not FLT-0002 (the drawing was reloaded)", links.includes(idOf("FLT-0006")) && !idOf("FLT-0002") && !links.some((l) => !saved.materials.some((m) => m.id === l)), JSON.stringify(links));

// ---- the material file has the status ------------------------------------------------------------------------------------
await tab("Materials");
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).click()]);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(await dl.path());
  const ws = wb.getWorksheet("Materials");
  const head = ws.getRow(1).values.slice(1);
  const r = []; ws.eachRow((x, i) => { if (i > 1 && x.values[1] === "FLT-0001") r.push(...x.values.slice(1)); });
  check("material file: Status and Replaced by columns", head.slice(7, 9).join() === "Status,Replaced by" && r[head.indexOf("Status")] === "Obsolete" && r[head.indexOf("Replaced by")] === "FLT-0011", JSON.stringify(r));
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
