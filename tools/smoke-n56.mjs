// Browser test of N5.6 (material changes during tech transfer, recorded and exported): a sampling bag that does
// not fit is replaced by its C-Flex version (a new material, Replace…, the old one obsolete), and a filter is
// changed in place (name, spec, part no.). The BOM marks "Replaces …", the comparison has one Replaced row and a
// Materials view (before → after), the Excel exports carry the Changes (materials) sheet, the change log says
// before → after, and the Materials export says what replaced what both ways. Quantities and links stay as they were.
// Usage: LANG=C.UTF-8 node tools/smoke-n56.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
const text = (sel) => page.locator(sel).innerText();
const flat = (s) => s.replace(/\n/g, " | ");
const tab = async (name) => { await page.getByRole("tab", { name: name === "Materials" ? /^Materials/ : name, exact: name !== "Materials" }).click(); await wait(600); };
const line = (uo, code) => page.locator(`tr[data-bom-line='${uo}|${code}']`);
const row = (code) => page.locator(`tr[data-code='${code}']`);
const toast = async () => (await page.locator(".toast").last().innerText().catch(() => ""));
const sheets = async (dl) => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(await dl.path());
  const out = {};
  wb.eachSheet((ws) => { out[ws.name] = []; ws.eachRow((r) => out[ws.name].push(Array.from(r.values.slice(1), (v) => (v == null ? "" : String(v))))); });
  return out;
};
const BAG = "NovaSeptum sampling bag 100 mL", CFLEX = "NovaSeptum sampling bag 100 mL, C-Flex tubing";

// The downstream example with the sampling bag on PROA: 4 per run, entered by hand.
const dir = mkdtempSync(join(tmpdir(), "pcs-n56-"));
const file = join(dir, "downstream-with-bag.pcs.json");
{
  const p = JSON.parse(readFileSync(resolve("examples/example-downstream.pcs.json"), "utf8"));
  const proa = p.uos.find((u) => u.code === "PROA").id;
  p.materials.push({ id: "mat_n56bag", code: "CON-0010", name: BAG, unit: "EA", category: "Consumable", spec: "Single-use, TPE tubing", supplier: "Supplier X", partNo: "NS-100" });
  p.bom.lines[proa] = [...(p.bom.lines[proa] ?? []), { materialId: "mat_n56bag", qtySource: "manual", manualQty: { sending: 4, receiving: 4 }, note: "4 samples per run" }];
  writeFileSync(file, JSON.stringify(p));
}

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForSelector(".excalidraw");
await page.evaluate(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith("pcs.bom.")) localStorage.removeItem(k); } catch { /* */ } });
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(file);
  await wait(2000);
}
await page.getByRole("button", { name: "Changes", exact: true }).click();
await page.getByLabel("Your name").fill("Tester");
await page.getByRole("button", { name: "Close", exact: true }).click();

// Rev A, as handed over.
await tab("BOM");
check("the bag is on PROA: 4 / 4, by hand", /4\s+4/.test(flat(await line("PROA", "CON-0010").innerText()).replace(/\|/g, " ")));
await page.getByRole("button", { name: "Save revision…" }).click();
await page.getByRole("button", { name: "Save revision", exact: true }).click();
await wait(400);
const totalsBefore = await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] tbody tr")].map((tr) => [...tr.children].slice(0, 6).map((c) => c.innerText.trim())));

// ---- 1) the C-Flex version as a new material, then Replace… -----------------------------------------------------------------
await tab("Materials");
await page.getByRole("button", { name: "Add material" }).click();
await wait(300);
const last = page.locator("tr[data-code]").last();
await last.getByLabel("Code").fill("CON-0011");
await last.getByLabel("Name").fill(CFLEX);
await last.getByLabel("Unit").fill("EA");
await last.getByLabel("Unit").press("Tab");
await wait(300);
await page.getByRole("button", { name: "More for CON-0010" }).click();
await page.getByRole("menuitem", { name: "Replace CON-0010" }).click();
await wait(300);
await page.getByLabel("Replace with").selectOption({ label: `CON-0011 · ${CFLEX} (EA)` });
await wait(200);
check("Replace: Mark obsolete is the default and says the revisions show it as replaced", await page.getByLabel(/Mark obsolete/).isChecked() && /BOM revisions show the change as replaced/.test(await text(".dialog")));
await page.getByRole("button", { name: "Replace with CON-0011" }).click();
await wait(1500);
check("replaced: CON-0010 is marked obsolete", /Replaced CON-0010 with CON-0011.*CON-0010 is marked obsolete/.test(await toast()), await toast());

await tab("BOM");
const mark = await line("PROA", "CON-0011").innerText();
check("BOM: the new line says Replaces CON-0010 since Rev A, same 4 / 4", /Replaces CON-0010 since Rev A/.test(mark) && !(await line("PROA", "CON-0010").count()), flat(mark).slice(0, 200));
check("BOM: no 'removed since' row for the old bag", !(await page.locator("tr.bom-removed", { hasText: "CON-0010" }).count()));
const summary = await text(".bom-tools .linkish");
check("BOM: the summary counts the replacement", summary === "0 added · 0 removed · 1 replaced · 0 changed since Rev A", summary);
if (shot) await line("PROA", "CON-0011").screenshot({ path: `${shot}-mark.png` });

await page.locator(".bom-tools .linkish").click();
await wait(300);
let dlg = await text(".dialog");
check("compare (totals): one Replaced row CON-0010 → CON-0011, was …", /1 replaced/.test(dlg) && /Replaced\s+CON-0010 → CON-0011/.test(dlg) && new RegExp(`was ${BAG}`).test(dlg), flat(dlg).slice(0, 400));
await page.getByRole("button", { name: "Lines per unit operation" }).click();
dlg = await text(".dialog");
check("compare (lines): Replaced PROA CON-0010 → CON-0011", /Replaced\s+PROA\s+CON-0010 → CON-0011/.test(dlg) && !/Removed\s+PROA\s+CON-0010/.test(dlg) && !/Added\s+PROA\s+CON-0011/.test(dlg));
await page.getByRole("button", { name: /^Materials \(\d+\)$/ }).click();
dlg = await text(".dialog");
check("compare (materials): the replacement, before → after", /Replaced\s+CON-0010 → CON-0011/.test(dlg) && new RegExp(`CON-0010 · ${BAG}`).test(dlg), flat(dlg).slice(0, 400));
if (shot) await page.locator(".dialog").screenshot({ path: `${shot}-compare-materials.png` });
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).last().click()]);
  const x = await sheets(dl);
  check("compare export: lines, totals and materials sheets", ["Changes (lines)", "Changes (totals)", "Changes (materials)"].every((n) => x[n]) && x["Changes (lines)"][1].slice(0, 3).join() === "Replaced,PROA,CON-0010 → CON-0011"
    && x["Changes (materials)"][1].join(" | ") === `Replaced | CON-0010 → CON-0011 | ${CFLEX} | Material | CON-0010 · ${BAG} | CON-0011 · ${CFLEX} | PROA`, JSON.stringify(x["Changes (materials)"]));
}
await page.getByRole("button", { name: "Close", exact: true }).click();

// ---- 2) a filter changed in place: name, spec, part no. ------------------------------------------------------------------------
await tab("Materials");
const oldName = await row("FLT-0001").getByLabel("Name").inputValue();
await row("FLT-0001").getByLabel("Name").fill(`${oldName}, low-extractable`);
await row("FLT-0001").getByLabel("Spec").fill("Low extractables");
await page.getByLabel("Purchasing").check();
await page.getByLabel("Part no. of FLT-0001").fill("DF-11-LE");
await page.getByLabel("Search materials").click();
await wait(500);
await tab("BOM");
await page.locator(".bom-tools .linkish").click();
await wait(300);
await page.getByRole("button", { name: /^Materials \(\d+\)$/ }).click();
dlg = await text(".dialog");
check("compare (materials): FLT-0001 Edited Name, Spec, Part no., before → after", /Edited\s+FLT-0001[\s\S]*Name/.test(dlg) && /Spec\s+–\s+Low extractables/.test(dlg) && /Part no\.\s+–\s+DF-11-LE/.test(dlg) && new RegExp(`${oldName.replace(/[()]/g, "\\$&")}\\s+${oldName.replace(/[()]/g, "\\$&")}, low-extractable`).test(dlg), flat(dlg).slice(0, 600));
await page.getByRole("button", { name: "Totals (what to buy)" }).click();
dlg = await text(".dialog");
check("compare (totals): FLT-0001 changed, the note says the part no.", /Changed\s+FLT-0001[\s\S]*part no\. – → DF-11-LE/.test(dlg), flat(dlg).slice(0, 500));
await page.getByRole("button", { name: "Close", exact: true }).click();
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).first().click()]);
  const x = await sheets(dl);
  const about = x.About.map((r) => r.join(" "));
  const mats = x["Changes (materials)"].map((r) => r.join(" | "));
  check("BOM export: About counts 1 replaced; the materials sheet has the replacement and the three edits", about.some((s) => /^Changes since Rev A .*0 added, 0 removed, 1 replaced, 1 changed lines; see the Changes sheets \(lines, totals, materials\)/.test(s))
    && mats.some((s) => s.startsWith("Replaced | CON-0010 → CON-0011")) && ["Name", "Spec", "Part no."].every((w) => mats.some((s) => s.startsWith(`Edited | FLT-0001 | ${oldName}, low-extractable | ${w} |`))), JSON.stringify(mats));
  const bom = x.BOM.find((r) => r[0] === "PROA" && r[3] === "CON-0011");
  check("BOM export: the PROA line is the C-Flex bag, 4 / 4", bom && bom[11] === "4" && bom[12] === "4", JSON.stringify(bom));
}
const totalsAfter = await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] tbody tr")].map((tr) => [...tr.children].slice(0, 6).map((c) => c.innerText.trim())));
const strip = (t) => t.filter((r) => !["CON-0010", "CON-0011", "FLT-0001"].includes(r[0])).map((r) => r.join("|")).join("\n");
check("totals of every other material are exactly as before", strip(totalsBefore) === strip(totalsAfter) && totalsAfter.find((r) => r[0] === "CON-0011")?.slice(4).join() === totalsBefore.find((r) => r[0] === "CON-0010")?.slice(4).join(), `${totalsAfter.length} rows`);

// ---- the change log: before → after ----------------------------------------------------------------------------------------
await page.getByRole("button", { name: "Changes", exact: true }).click();
await wait(300);
const log = flat(await text(".changes-table"));
check("change log: added with its name, the replacement, and the in-place edits before → after",
  new RegExp(`Materials added: CON-0011 “${CFLEX}”`).test(log) && /Replace CON-0010 with CON-0011\s*\|\s*Material CON-0010: status In use → Obsolete; replaced by CON-0011/.test(log)
  && /Material FLT-0001: name “[^”]+” → “[^”]+, low-extractable”/.test(log) && /spec – → “Low extractables”/.test(log) && /part no\. – → DF-11-LE/.test(log), log.slice(0, 700));
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".dialog").getByRole("button", { name: "Export to Excel" }).click()]);
  const x = await sheets(dl);
  const r = x.Changes.find((c) => c[2] === "Replace CON-0010 with CON-0011");
  check("change log export: the replacement row, by Tester", r && r[1] === "Tester" && /Material CON-0010: status In use → Obsolete; replaced by CON-0011/.test(r[3]), JSON.stringify(r));
}
await page.getByRole("button", { name: "Close", exact: true }).click();

// ---- the material list: what replaced what, both ways --------------------------------------------------------------------------
await tab("Materials");
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export to Excel" }).click()]);
  const x = await sheets(dl);
  const head = x.Materials[0];
  const get = (c, h) => x.Materials.find((r) => r[0] === c)?.[head.indexOf(h)];
  check("Materials export: CON-0010 Obsolete, replaced by CON-0011; CON-0011 replaces CON-0010", head.at(-1) === "Replaces" && get("CON-0010", "Status") === "Obsolete" && get("CON-0010", "Replaced by") === "CON-0011" && get("CON-0011", "Replaces") === "CON-0010", JSON.stringify(head));
}
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
  const saved = JSON.parse(readFileSync(await dl.path(), "utf8"));
  const snap = saved.bom.revisions?.[0]?.materials?.find((m) => m.code === "CON-0010");
  check("the project file keeps Rev A's material details", snap && snap.partNo === "NS-100" && snap.spec === "Single-use, TPE tubing", JSON.stringify(snap));
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
