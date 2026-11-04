// Browser test of the symbol palette: downstream symbols by category and search, uploading your own
// symbols (SVG, PNG, an Excalidraw library), inserting them like built-in ones, material links on them
// and the BOM, saving a selection as a symbol, renaming and removing, export/import of a symbol set,
// and reload.
// Usage: LANG=C.UTF-8 node tools/smoke-symbols.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

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
const ex = (f) => resolve("examples", f);

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForFunction(() => window.__pcsPfd?.api);
await page.getByRole("button", { name: "New", exact: true }).click();
await page.locator(".dialog input.search").fill("Symbols test");
await page.getByRole("button", { name: "Create", exact: true }).click();
const discard = page.getByRole("button", { name: "Start new without saving" });
if (await discard.isVisible({ timeout: 1500 }).catch(() => false)) await discard.click();
await wait(800);
await page.locator(".sheet-tab.add").click();
await page.waitForFunction(() => window.__pcsPfd?.api);
await wait(900);

const scene = () => page.evaluate(() => window.__pcsPfd.api.getSceneElements().map((e) => ({ id: e.id, type: e.type, text: e.text, groupIds: e.groupIds, fileId: e.fileId, frameId: e.frameId, pcs: e.customData?.pcs ?? null })));
const stored = () => page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open("pcs-platform", 1); r.onsuccess = () => res(r.result); });
  const rec = await new Promise((res) => { const t = db.transaction("projects").objectStore("projects").get("current"); t.onsuccess = () => res(t.result); });
  return JSON.parse(rec.text);
});
const groupsShown = () => page.locator(".symbol-group .symbol-cat").allInnerTexts();
const tile = (name) => page.locator(".symbol", { has: page.locator(".symbol-name", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) });
const selectGroupOf = (pred) => page.evaluate((src) => {
  const api = window.__pcsPfd.api;
  const f = new Function("e", `return (${src})(e)`);
  const body = api.getSceneElements().find((e) => f(e));
  const g = body.groupIds[body.groupIds.length - 1];
  const members = api.getSceneElements().filter((e) => e.groupIds?.includes(g));
  api.updateScene({ appState: { selectedElementIds: Object.fromEntries(members.map((m) => [m.id, true])), selectedGroupIds: { [g]: true } } });
}, pred.toString());

// ---- built-in downstream symbols ------------------------------------------------------------------
const cats = (await groupsShown()).map((c) => c.toLowerCase());
check("palette is grouped by category", ["upstream", "vessels & bags", "filtration & clarification", "chromatography & purification", "pumps, valves & lines", "instruments", "fill & storage"].every((c) => cats.includes(c)), cats.join(" | "));
check("at least 45 built-in symbols", (await page.locator(".symbol").count()) >= 45, String(await page.locator(".symbol").count()));
await page.getByLabel("Search symbols").fill("filter");
await wait(200);
const filters = await page.locator(".symbol .symbol-name").allInnerTexts();
check("search 'filter' lists the filter types", ["Filter", "Depth filter", "Sterile filter (0.2 µm)", "Prefilter", "Virus filter", "Cartridge filter in housing"].every((n) => filters.includes(n)), filters.join(", "));
await tile("Sterile filter (0.2 µm)").click();
await wait(300);
await page.getByLabel("Search symbols").fill("");
let els = await scene();
const sterile = els.find((e) => e.pcs?.symbol === "sterile");
check("a downstream symbol is inserted into the frame, labelled", !!sterile?.frameId && els.some((e) => e.type === "text" && e.text === "0.2 µm filter" && e.groupIds.includes(sterile.groupIds.at(-1))));
for (const n of ["Protein A column", "Single-use mixer", "3D bag in tote", "Pinch valve (single-use)"]) { await tile(n).click(); await wait(200); }
els = await scene();
check("Protein A, SU mixer, 3D bag and pinch valve inserted", ["proa", "sumixer", "bag3d", "pinch"].every((id) => els.some((e) => e.pcs?.symbol === id)));

// ---- upload your own symbols --------------------------------------------------------------------------
const png = await page.screenshot({ clip: { x: 1210, y: 150, width: 90, height: 80 } });
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload symbols…" }).click()]);
  const file = (f, mimeType) => ({ name: f.split("/").pop(), mimeType, buffer: readFileSync(ex(f)) });
  await chooser.setFiles([
    file("symbols/chromatography-skid.svg", "image/svg+xml"), file("symbols/tff-skid.svg", "image/svg+xml"), file("symbols/example-library.excalidrawlib", ""),
    { name: "single-use_sensor.png", mimeType: "image/png", buffer: png },
  ]);
  await wait(1500);
}
let p = await (async () => { await wait(1200); return stored(); })();
check("uploaded: 2 SVG, 1 PNG, 2 library items", p.symbols.length === 5 && p.symbols.filter((s) => s.kind === "image").length === 3, p.symbols.map((s) => `${s.name}:${s.kind}`).join(", "));
check("they show under My symbols, first", (await groupsShown())[0].toLowerCase() === "my symbols" && (await page.locator(".symbol.mine").count()) === 5);
await tile("chromatography skid").click();
await wait(500);
els = await scene();
const skid = els.find((e) => e.type === "image" && e.pcs?.symbol === p.symbols.find((s) => s.name === "chromatography skid").id);
check("an uploaded picture is inserted like a built-in symbol (in the frame, with its name)", !!skid?.frameId && els.some((e) => e.type === "text" && e.text === "chromatography skid" && e.groupIds.includes(skid.groupIds.at(-1))));
const fileOk = await page.evaluate((fid) => !!window.__pcsPfd.api.getFiles()[fid], skid?.fileId);
check("its picture is loaded in the drawing", fileOk);
await tile("Tube welder").click();
await wait(500);
els = await scene();
const welder = els.filter((e) => e.groupIds?.length && els.find((b) => b.pcs?.symbol === p.symbols.find((s) => s.name === "Tube welder").id)?.groupIds.at(-1) === e.groupIds.at(-1));
check("a library item is inserted as editable shapes with new ids", welder.length === 4 && welder.some((e) => e.type === "text" && e.text === "WELD") && !welder.some((e) => e.id === "a1"), welder.map((e) => e.type).join(","));

// Material link on the uploaded symbol counts in the BOM (the new project has the 18 sample materials).
await selectGroupOf((e) => e.type === "image" && e.customData?.pcs?.symbol);
await wait(300);
check("the inspector names the uploaded symbol", /Equipment · chromatography skid/.test(await page.locator(".inspector").innerText()));
await page.getByLabel("Material to link").selectOption({ label: "MAT-0018 · Single-use Bag 500 L (EA)" });
await page.getByRole("button", { name: "Link", exact: true }).click();
await wait(900);
await page.getByRole("tab", { name: "BOM", exact: true }).click();
await wait(600);
check("the link on an uploaded symbol is a BOM line (source PFD)", /MAT-0018[\s\S]*PFD/.test(await page.locator(".page").innerText()));
await page.getByRole("tab", { name: "PFD", exact: true }).click();
await wait(300);

// ---- Hold vessel, Transfer panel, and a line material on an arrow -------------------------------------------
await page.evaluate(() => window.__pcsPfd.api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} } }));
await page.getByRole("tab", { name: "Symbols" }).click();
check("Tank is now called Hold vessel", await tile("Hold vessel").isVisible() && !(await tile("Tank").count()));
await tile("Transfer panel").click();
await wait(400);
await selectGroupOf((e) => e.customData?.pcs?.symbol === "transferpanel");
await wait(300);
await page.getByLabel("Material to link").selectOption({ label: "MAT-0039 · Transfer Panel (EA)" });
await page.getByRole("button", { name: "Link", exact: true }).click();
await wait(500);
const arrowId = await page.evaluate(() => {
  const api = window.__pcsPfd.api;
  const f = api.getSceneElements().find((e) => e.type === "frame");
  const [a] = window.__pcsPfd.convert([{ type: "arrow", x: f.x + 30, y: f.y + f.height - 30, width: 160, height: 0, points: [[0, 0], [160, 0]] }], { regenerateIds: true });
  api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), a] });
  return a.id;
});
await wait(1200);
await page.evaluate((id) => window.__pcsPfd.api.updateScene({ appState: { selectedElementIds: { [id]: true } } }), arrowId);
await wait(400);
check("an arrow offers line materials", /Lines and parts on this arrow/.test(await page.locator(".inspector").innerText()));
await page.getByLabel("Material to link").selectOption({ label: '1.5" Line 2 m', exact: false }).catch(async () => {
  const opt = await page.locator("select[aria-label='Material to link'] option", { hasText: '1.5" Line 2 m' }).first().getAttribute("value");
  await page.getByLabel("Material to link").selectOption(opt);
});
await page.getByRole("button", { name: "Link", exact: true }).click();
await wait(900);
await page.getByRole("tab", { name: "BOM", exact: true }).click();
await wait(600);
const bomText = await page.locator(".page").innerText();
check("the transfer panel and the line on the arrow are BOM lines (source PFD)", /MAT-0039[\s\S]*Transfer Panel[\s\S]*PFD/.test(bomText) && /MAT-0033[\s\S]*1\.5" Line 2 m[\s\S]*PFD/.test(bomText));
await page.getByRole("tab", { name: "PFD", exact: true }).click();
await wait(300);

// ---- save a selection as a symbol ----------------------------------------------------------------------
await selectGroupOf((e) => e.customData?.pcs?.symbol === "sterile");
await wait(300);
await page.getByRole("button", { name: "Save as symbol…" }).click();
await page.getByLabel("New symbol name").fill("Capsule 10 inch");
await page.getByLabel("New symbol category").fill("Filtration & clarification");
await page.getByRole("button", { name: "Save symbol" }).click();
await wait(500);
await page.evaluate(() => window.__pcsPfd.api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} } }));
await page.getByRole("tab", { name: "Symbols" }).click();
await wait(300);
const filtGroup = page.locator("section.symbol-group[aria-label='Filtration & clarification']");
check("a saved selection sits next to the built-in filters", (await filtGroup.locator(".symbol.mine .symbol-name").allInnerTexts()).includes("Capsule 10 inch"));
const before = (await scene()).length;
await tile("Capsule 10 inch").click();
await wait(500);
els = await scene();
check("and inserts as a copy with its own ids", els.length > before && els.filter((e) => e.pcs?.symbol === "sterile").length === 1);

// ---- manage: rename, remove; export and import ----------------------------------------------------------
await page.getByRole("button", { name: /^My symbols \d+$/ }).click();
const nameInputs = page.getByLabel("Symbol name");
await nameInputs.nth(1).fill("TFF skid 2 m²");
await nameInputs.nth(1).press("Enter");
await page.getByRole("button", { name: "Delete symbol Inline flow cell" }).click();
await page.getByRole("button", { name: "Remove symbol" }).click();
await wait(1600);
p = await stored();
check("rename and remove", p.symbols.some((s) => s.name === "TFF skid 2 m²") && !p.symbols.some((s) => s.name === "Inline flow cell") && p.symbols.length === 5, p.symbols.map((s) => s.name).join(", "));
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export set" }).click()]);
const set = JSON.parse(readFileSync(await download.path(), "utf8"));
check("export: one file with all symbols", set.format === "pcs-symbols" && set.symbols.length === 5, `${download.suggestedFilename()} ${set.symbols?.length}`);
if (shot) await page.screenshot({ path: `${shot}-palette.png` });

// ---- reload, then a new project gets them back from the set file -------------------------------------------
await page.reload();
await page.waitForFunction(() => window.__pcsPfd?.api);
await wait(800);
p = await stored();
check("after reload the symbols are still there", p.symbols.length === 5 && (await page.locator(".symbol.mine").count()) === 5);
await page.getByRole("button", { name: "New", exact: true }).click();
await page.getByRole("button", { name: "Create", exact: true }).click();
if (await discard.isVisible({ timeout: 1500 }).catch(() => false)) await discard.click();
await wait(800);
check("a new project starts without them", (await page.locator(".symbol.mine").count()) === 0);
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload symbols…" }).click()]);
  await chooser.setFiles({ name: "symbols.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(set)) });
  await wait(1500);
}
check("uploading the set file brings them all back", (await page.locator(".symbol.mine").count()) === 5);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
