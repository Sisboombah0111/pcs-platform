// Linkage snapshot: everything the linkage produces for a project, as one JSON file, so that a change that is
// meant to touch only the screens can be checked to leave it exactly as it was:
//   - the saved project file (.pcs.json) without views, times and the change log,
//   - the Excel exports of the BOM, Materials, Operations and the applied MB values (cell values),
//   - the text of the PowerPoint export, the link check, and every label on the PFD drawings.
// Usage: LANG=C.UTF-8 node tools/linkage-snapshot.mjs <base-url> <out.json> [project.pcs.json]
//   then compare two snapshots: node tools/linkage-snapshot.mjs --compare before.json after.json
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);

if (args[0] === "--compare") {
  const [a, b] = [JSON.parse(readFileSync(args[1], "utf8")), JSON.parse(readFileSync(args[2], "utf8"))];
  const diffs = [];
  const walk = (x, y, path) => {
    if (diffs.length > 30) return;
    if (typeof x !== typeof y || Array.isArray(x) !== Array.isArray(y) || (x === null) !== (y === null)) { diffs.push(`${path}: ${JSON.stringify(x)?.slice(0, 120)} → ${JSON.stringify(y)?.slice(0, 120)}`); return; }
    if (x && typeof x === "object") {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) walk(x[k], y[k], `${path}/${k}`);
    } else if (x !== y) diffs.push(`${path}: ${JSON.stringify(x)?.slice(0, 120)} → ${JSON.stringify(y)?.slice(0, 120)}`);
  };
  for (const part of Object.keys({ ...a, ...b })) walk(a[part], b[part], part);
  if (diffs.length) { console.log(`DIFFERENT (${diffs.length}${diffs.length > 30 ? "+" : ""}):`); for (const d of diffs) console.log("  " + d); process.exit(1); }
  console.log(`IDENTICAL: ${Object.keys(a).map((k) => `${k} (${JSON.stringify(a[k]).length} chars)`).join(", ")}`);
  process.exit(0);
}

let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const [base, out, projectFile = "examples/example-downstream.pcs.json"] = args;
const DATE = /\b\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?\b/g;
const TIME = /\b\d{1,2}:\d{2}(:\d{2})?\b/g;
const scrub = (s) => (typeof s === "string" ? s.replace(DATE, "<date>") : s);

async function cells(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = {};
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      rows.push(row.values.slice(1).map((v) => {
        if (v && typeof v === "object") { if ("result" in v) return v.result; if ("richText" in v) return v.richText.map((t) => t.text).join(""); if (v instanceof Date) return "<date>"; if ("text" in v) return v.text; }
        return scrub(v ?? null);
      }));
    });
    sheets[ws.name] = rows;
  });
  return sheets;
}

function normalizeProject(p) {
  const drop = (o) => {
    if (Array.isArray(o)) return o.map(drop);
    if (o && typeof o === "object") {
      const r = {};
      for (const [k, v] of Object.entries(o)) {
        if (["view", "changeLog", "savedAt", "updatedAt", "createdAt", "modifiedAt", "updated", "version", "versionNonce", "seed", "appliedAt", "uploadedAt"].includes(k)) continue;
        r[k] = drop(v);
      }
      return r;
    }
    return scrub(o);
  };
  return drop(p);
}

const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const wait = (ms) => page.waitForTimeout(ms);
const tab = async (name) => { await page.getByRole("tab", { name: new RegExp(`^${name}`) }).first().click(); await wait(700); };
const download = async (click) => { const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), click()]); return readFileSync(await d.path()); };
/** An export that a project may not have (no applied MB, no steps): null instead of a download. */
const step = (what) => { if (process.env.SNAP_DEBUG) console.error(`… ${what}`); };
const exportOn = async (name) => { step(name); const b = page.getByRole("button", { name: "Export to Excel" }).first(); if (!(await b.isVisible().catch(() => false)) || await b.isDisabled()) return null; return cells(await download(() => b.click())); };

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForSelector(".excalidraw");
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(resolve(projectFile));
  await wait(2500);
}

const snap = {};
// every label on every drawing (process map and unit operations), as the app shows them
snap.pfdLabels = await page.evaluate(async () => {
  const all = [];
  for (const el of window.__pcsPfd.all()) if (el.type === "text" && !el.isDeleted) all.push(el.originalText ?? el.text);
  return all.sort();
});
await page.locator(".link-chip").first().click();
await wait(500);
snap.linkCheck = (await page.locator(".dialog").first().innerText()).replace(TIME, "<time>");
await page.keyboard.press("Escape");
await wait(300);

await tab("BOM");
snap.bomTotalsShown = await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] tr")].map((tr) => [...tr.children].map((c) => c.innerText.trim())));
snap.bomExcel = await exportOn("BOM");
await tab("Materials");
snap.materialsExcel = await exportOn("Materials");
await tab("Operations");
snap.operationsExcel = await exportOn("Operations");
await tab("Mass Balance");
snap.mbAppliedExcel = await exportOn("Mass Balance");
await tab("PFD");
step("PowerPoint");
await page.getByRole("button", { name: /Export to PowerPoint/ }).click();
await wait(500);
const pptxBtn = page.locator(".dialog .btn.primary");
const pptxText = (await pptxBtn.innerText().catch(() => "")).trim();
const pptx = await pptxBtn.isDisabled() ? null : await download(() => pptxBtn.click()).catch((e) => { console.error(`PowerPoint export (${pptxText}): ${e.message.split("\n")[0]}`); return null; });
await page.keyboard.press("Escape");
if (pptx) {
  const zip = await JSZip.loadAsync(pptx);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  snap.pptxText = [];
  for (const f of slides) snap.pptxText.push([...(await zip.file(f).async("string")).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => scrub(m[1])));
}
await wait(500);
step("project file");
snap.project = normalizeProject(JSON.parse((await download(() => page.getByRole("button", { name: /Save to file/ }).first().click())).toString("utf8")));
snap.pageErrors = errors;
await browser.close();
writeFileSync(out, JSON.stringify(snap, null, 1));
console.log(`snapshot: ${Object.keys(snap).join(", ")} → ${out}`);
