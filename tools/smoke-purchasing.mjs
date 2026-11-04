// Browser test of N4.15: purchasing columns on Materials (supplier, part no., pack size) and whole packs on the
// BOM totals; selecting materials and editing them together (with undo); duplicating a unit operation (drawing
// with new Stream IDs, steps, BOM lines, equipment with new tags).
// Usage: LANG=C.UTF-8 node tools/smoke-purchasing.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); localStorage.removeItem("pcs.materials.buying"); for (const k of Object.keys(localStorage)) if (k.startsWith("pcs.ops.")) localStorage.removeItem(k); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const text = (sel) => page.locator(sel).first().innerText();
const toast = async () => (await page.locator(".toast").last().innerText().catch(() => ""));
const tab = async (name) => { await page.getByRole("tab", { name: name === "Materials" ? /^Materials/ : name, exact: name !== "Materials" }).click(); await wait(500); };
const row = (code) => page.locator(`tr[data-code='${code}']`);
const totals = () => page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] tbody tr")].map((tr) => [...tr.children].map((c) => c.innerText.trim())));

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

// ---- purchasing columns and packs ----------------------------------------------------------------------------------------
await tab("Materials");
check("purchasing columns are off at first", (await page.getByLabel("Supplier of CHM-0002").count()) === 0);
await page.getByLabel("Purchasing").check();
await wait(200);
await page.getByLabel("Supplier of CHM-0002").fill("Merck");
await page.getByLabel("Part no. of CHM-0002").fill("1.06404.5000");
await page.getByLabel("Pack size of CHM-0002").fill("25");
await page.getByLabel("Pack size of CHM-0002").press("Enter");
await wait(300);
check("pack size kept on the material (25 kg)", (await page.getByLabel("Pack size of CHM-0002").inputValue()) === "25" && /kg/.test(await row("CHM-0002").innerText()));
await tab("BOM");
const t = await totals();
const head = await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Totals'] thead th")].map((th) => th.innerText.trim()));
const nacl = t.find((r) => r[0] === "CHM-0002");
const iS = head.indexOf("Sending"), iR = head.indexOf("Receiving"), iO = head.indexOf("To order");
const num = (s) => Number(s.replace(/,/g, ""));
const want = `${Math.ceil(num(nacl[iS]) / 25)} / ${Math.ceil(num(nacl[iR]) / 25)} × 25 kg`;
check("BOM totals: To order in whole 25 kg packs", iO > 0 && nacl[iO].startsWith(want), `${nacl[iS]} / ${nacl[iR]} → ${nacl[iO]} (want ${want})`);
check("materials without a pack size have no To order", (t.find((r) => r[0] === "CHM-0001") ?? [])[iO] === "");
if (shot) await page.locator("section[aria-label='Totals']").screenshot({ path: `${shot}-packs.png` });

// ---- select and edit together -------------------------------------------------------------------------------------------------
await tab("Materials");
await page.getByLabel("Select CHM-0001").check();
await page.getByLabel("Select CHM-0003").check();
check("selection bar: 2 selected", /2 selected/.test(await text(".bulk-bar")));
await page.getByRole("button", { name: "Edit selected…" }).click();
await page.getByLabel("Bulk Supplier").fill("Sigma");
await page.getByLabel("Bulk Overage %").fill("3");
await page.getByRole("button", { name: "Apply to 2" }).click();
await wait(300);
const supplierOf = (c) => page.getByLabel(`Supplier of ${c}`).inputValue();
check("bulk edit: both have the supplier and 3 % overage, others unchanged", (await supplierOf("CHM-0001")) === "Sigma" && (await supplierOf("CHM-0003")) === "Sigma" && (await supplierOf("CHM-0002")) === "Merck"
  && /3/.test(await row("CHM-0001").locator("td").nth(6).locator("input").inputValue()));
if (shot) await page.screenshot({ path: `${shot}-bulk.png` });
await page.getByRole("button", { name: "Undo change" }).click();
await wait(300);
check("undo takes the bulk edit back", (await supplierOf("CHM-0001")) === "" && (await supplierOf("CHM-0003")) === "");
await page.getByRole("button", { name: "Clear selection" }).click();

// ---- duplicate a unit operation -------------------------------------------------------------------------------------------------
await tab("PFD");
await page.getByRole("tab", { name: /^Units/ }).click();
await page.getByRole("button", { name: "Duplicate PROA" }).click();
await wait(300);
const dlg = (await text(".dialog")).replace(/\n/g, " | ");
check("duplicate dialog: code PROA2, steps, BOM line, new tags XV-101 → XV-201", (await page.getByLabel("Code of the copy").inputValue()) === "PROA2" && /Steps on Operations \(14\)/.test(dlg) && /BOM lines you set or added \(1\)/.test(dlg) && /XV-101 → XV-201/.test(dlg), dlg.slice(0, 300));
await page.getByRole("button", { name: "Duplicate", exact: true }).click();
await wait(2500);
const msg = await toast();
check("duplicated: drawing with its streams, steps, BOM line, 16 new tags", /PROA2 made from PROA: drawing \(12 streams\), 14 steps, 1 BOM lines, 16 new tags/.test(msg), msg);
const proa2 = await page.evaluate(() => {
  const els = window.__pcsPfd.api.getSceneElements();
  return {
    frame: els.find((e) => e.type === "frame")?.name,
    ids: els.filter((e) => e.type === "arrow" && e.customData?.pcs?.streamId).map((e) => e.customData.pcs.streamId).sort(),
    labels: els.filter((e) => e.type === "text").map((e) => (e.originalText ?? e.text).split("\n")[0]),
  };
});
check("the copy's drawing: its frame, ST-PROA2-001 …, valves tagged XV-201 …", proa2.frame === "PROA2 · Protein A, VI, depth filtration (copy)" && proa2.ids[0] === "ST-PROA2-001" && proa2.ids.length === 12 && proa2.labels.includes("XV-201") && proa2.labels.includes("C-201") && !proa2.labels.includes("XV-101"), JSON.stringify(proa2).slice(0, 300));
if (shot) await page.screenshot({ path: `${shot}-duplicate.png` });
await tab("Operations");
await page.locator(".ops-nav-item", { hasText: "PROA2" }).click();
await wait(300);
const s3 = (await page.locator("tr[data-step='3']").innerText()).replace(/\n/g, " ");
check("the copy's steps use its streams and its new tags", /ST-PROA2-001/.test(s3) && /Open XV-201/.test(s3) && /Close XV-202/.test(s3), s3.slice(0, 200));
await tab("BOM");
check("the copy's BOM has the resin line", await page.locator("tr[data-bom-line='PROA2|RES-0001']").count() === 1);
check("link check: no new problem (the copy's streams only have no MB values yet)", /^Linked/.test((await text(".link-chip")).trim()), await text(".link-chip"));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
