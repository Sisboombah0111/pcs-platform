// Browser test of the PFD: the process map (UO boxes, transfers), one drawing per unit operation
// (frame, symbols, stream IDs and labels, connectors for transfers and arrows to them), delete/undo,
// duplicate, renaming, adding and deleting a unit operation, material links, tables, and reload.
// Usage: LANG=C.UTF-8 node tools/smoke-pfd.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const { chromium } = playwright;

const [base, shot] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
// The in-app guide opens on a first visit; these checks run with it closed (tools/smoke-guide.mjs tests it).
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const settle = () => page.waitForTimeout(900);
const saved = () => page.waitForTimeout(1600);

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForFunction(() => window.__pcsPfd?.api);

// ---- helpers ------------------------------------------------------------------------------------
const scene = () => page.evaluate(() => window.__pcsPfd.api.getSceneElements().map((e) => ({
  id: e.id, type: e.type, name: e.name, text: e.originalText ?? e.text, frameId: e.frameId, groupIds: e.groupIds, locked: e.locked,
  containerId: e.containerId, pcs: e.customData?.pcs ?? null, x: e.x, y: e.y, width: e.width, height: e.height,
  start: e.startBinding?.elementId, end: e.endBinding?.elementId,
})));
const stored = () => page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open("pcs-platform", 1); r.onsuccess = () => res(r.result); });
  const rec = await new Promise((res) => { const t = db.transaction("projects").objectStore("projects").get("current"); t.onsuccess = () => res(t.result); });
  return JSON.parse(rec.text);
});
const tabs = () => page.locator(".sheet-tab").allInnerTexts();
const tabTitles = () => page.locator(".sheet-tab:not(.map):not(.add)").evaluateAll((ts) => ts.map((t) => t.title));
const openTab = async (text) => {
  await page.locator(".sheet-tab", { hasText: text }).first().click();
  await page.waitForFunction(() => window.__pcsPfd?.api);
  await settle();
};
const streamOf = (els, id) => els.find((e) => e.id === id)?.pcs?.streamId;
const textIn = (els, id) => els.find((e) => e.type === "text" && e.containerId === id)?.text;
const ports = (els) => els.filter((e) => e.type === "rectangle" && e.pcs?.port);
const select = (id) => page.evaluate((id) => window.__pcsPfd.api.updateScene({ appState: { selectedElementIds: id ? { [id]: true } : {} } }), id);
const toScreen = (pt) => page.evaluate((pt) => {
  const st = window.__pcsPfd.api.getAppState();
  return { x: (pt.x + st.scrollX) * st.zoom.value + st.offsetLeft, y: (pt.y + st.scrollY) * st.zoom.value + st.offsetTop };
}, pt);
const centre = (e) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
const arrowIds = () => page.evaluate(() => window.__pcsPfd.api.getSceneElements().filter((e) => e.type === "arrow").map((e) => e.id));
/** Draw an arrow with the mouse, so Excalidraw binds it like a user would. */
const drawArrow = async (from, to) => {
  const before = await arrowIds();
  await page.locator('[data-testid="toolbar-arrow"]').click({ force: true });
  const a = await toScreen(from), b = await toScreen(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return (await arrowIds()).find((id) => !before.includes(id));
};
/** Fit everything at 60 %, shifted right of Excalidraw's shape-properties island (it covers the left edge). */
const fitView = async () => {
  await page.evaluate(() => {
    const api = window.__pcsPfd.api;
    const els = api.getSceneElements();
    const minX = Math.min(...els.map((e) => e.x)), minY = Math.min(...els.map((e) => e.y)), maxY = Math.max(...els.map((e) => e.y + e.height));
    const st = api.getAppState(), zoom = 0.6;
    api.updateScene({ appState: { zoom: { value: zoom }, scrollX: 300 / zoom - minX, scrollY: st.height / 2 / zoom - (minY + maxY) / 2 } });
  });
  await page.waitForTimeout(400);
};
const clickArrow = async (id) => {
  const pt = await page.evaluate((id) => {
    const api = window.__pcsPfd.api;
    const e = api.getSceneElements().find((x) => x.id === id);
    const st = api.getAppState();
    let best = 0, len = -1;
    for (let i = 0; i < e.points.length - 1; i++) {
      const l = Math.hypot(e.points[i + 1][0] - e.points[i][0], e.points[i + 1][1] - e.points[i][1]);
      if (l > len) { len = l; best = i; }
    }
    const p0 = e.points[best], p1 = e.points[best + 1];
    const sx = e.x + p0[0] + (p1[0] - p0[0]) / 4, sy = e.y + p0[1] + (p1[1] - p0[1]) / 4;
    return { x: (sx + st.scrollX) * st.zoom.value + st.offsetLeft, y: (sy + st.scrollY) * st.zoom.value + st.offsetTop };
  }, id);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(200);
};
const insertSymbol = async (name) => {
  await page.getByRole("tab", { name: "Symbols" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(300);
};
const moveGroup = (symbol, dx) => page.evaluate(({ symbol, dx }) => {
  const api = window.__pcsPfd.api;
  const all = api.getSceneElementsIncludingDeleted();
  const g = all.find((e) => e.customData?.pcs?.symbol === symbol).groupIds[0];
  api.updateScene({ elements: all.map((e) => (e.groupIds?.includes(g) ? { ...e, x: e.x + dx, version: e.version + 1 } : e)) });
}, { symbol, dx });

// ---- process map: two unit operations and a transfer ----------------------------------------------
await page.getByRole("tab", { name: /^Units/ }).click();
await page.getByLabel("New unit operation name").fill("100L Bioreactor");
await page.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(500);
await page.getByLabel("New unit operation name").fill("Harvest clarification");
await page.getByRole("button", { name: "Add", exact: true }).click();
await settle();
let els = await scene();
const boxes = els.filter((e) => e.pcs?.kind === "uo" && e.type === "rectangle");
check("two UO boxes on the process map", boxes.length === 2, boxes.length);
check("box texts '<code>\\n<name>'", textIn(els, boxes[0].id) === "100L\n100L Bioreactor" && textIn(els, boxes[1].id) === "HARVE\nHarvest clarification",
  `${JSON.stringify(textIn(els, boxes[0].id))} ${JSON.stringify(textIn(els, boxes[1].id))}`);
// N5.1: a drawing tab shows the code (the open one also the name); every tab has code · name as its tooltip.
check("a tab per unit operation", JSON.stringify(await tabs()) === JSON.stringify(["Process map", "100L", "HARVE", "+ Unit operation"]) && JSON.stringify(await tabTitles()) === JSON.stringify(["100L · 100L Bioreactor", "HARVE · Harvest clarification"]), `${(await tabs()).join(" | ")} / ${(await tabTitles()).join(" | ")}`);

await fitView();
const TRANSFER = await drawArrow(centre(boxes[0]), centre(boxes[1]));
await settle();
els = await scene();
check("arrow from box to box → transfer ST-100L-HARVE", streamOf(els, TRANSFER) === "ST-100L-HARVE", streamOf(els, TRANSFER));
check("transfer label on the map", textIn(els, TRANSFER) === "ST-100L-HARVE", textIn(els, TRANSFER));
const NOTE = await drawArrow({ x: boxes[0].x, y: boxes[0].y + 300 }, { x: boxes[0].x + 200, y: boxes[0].y + 300 });
await settle();
check("arrow not between boxes → no stream", !streamOf(await scene(), NOTE));
if (shot) await page.screenshot({ path: `${shot}-map.png` });

// ---- 100L drawing ----------------------------------------------------------------------------------
await openTab("100L");
els = await scene();
const frame100 = els.find((e) => e.type === "frame");
check("the 100L drawing has its frame", frame100?.name === "100L · 100L Bioreactor", frame100?.name);
let [out] = ports(els);
check("a connector for the outgoing transfer, right of the frame", out && out.pcs.dir === "out" && textIn(els, out.id) === "To HARVE\nST-100L-HARVE" && out.x > frame100.x + frame100.width,
  out && JSON.stringify(textIn(els, out.id)));
await page.evaluate((id) => { const api = window.__pcsPfd.api; const f = api.getSceneElements().find((e) => e.id === id); api.scrollToContent(f, { animate: false }); }, frame100.id);
await insertSymbol("Single-use bag");
await moveGroup("bag", -200);
await insertSymbol("Bioreactor");
await settle();
await fitView();
els = await scene();
const bag = els.find((e) => e.pcs?.symbol === "bag"), reactor = els.find((e) => e.pcs?.symbol === "bioreactor");
check("symbols land in the frame", !!bag?.frameId && !!reactor?.frameId);
const FEED = await drawArrow(centre(bag), centre(reactor));
out = ports(await scene())[0];
const SEG = await drawArrow(centre(reactor), centre(out));
await settle();
els = await scene();
check("arrow inside the UO → ST-100L-001", streamOf(els, FEED) === "ST-100L-001" && textIn(els, FEED) === "ST-100L-001", `${streamOf(els, FEED)} / ${textIn(els, FEED)}`);
check("arrow to the connector carries the transfer ID", streamOf(els, SEG) === "ST-100L-HARVE" && els.find((e) => e.id === SEG).pcs.segment === true && textIn(els, SEG) === "ST-100L-HARVE",
  JSON.stringify(els.find((e) => e.id === SEG)?.pcs));
await saved();
let p = await stored();
check("registry: the arrow to the connector has no ID of its own", JSON.stringify(Object.keys(p.streams.active).sort()) === JSON.stringify(["ST-100L-001", "ST-100L-HARVE"]), Object.keys(p.streams.active).join(","));

// Name streams from the panel: the transfer (from the arrow to its connector) and the feed.
await select(SEG);
await page.waitForTimeout(300);
await page.getByPlaceholder("e.g. Basal media feed").fill("Harvest to clarification");
await page.getByPlaceholder("e.g. Basal media feed").press("Enter");
await select(FEED);
await page.waitForTimeout(300);
await page.getByPlaceholder("e.g. Basal media feed").fill("Basal media");
await page.getByPlaceholder("e.g. Basal media feed").press("Enter");
await settle();
els = await scene();
check("stream name appears in the label", textIn(els, FEED) === "ST-100L-001\nBasal media", JSON.stringify(textIn(els, FEED)));
check("the transfer's name shows on the arrow to its connector", textIn(els, SEG) === "ST-100L-HARVE\nHarvest to clarification", JSON.stringify(textIn(els, SEG)));
if (shot) await page.screenshot({ path: `${shot}-uo.png` });

// Delete → retired; undo → back (real clicks and keys)
await select(null);
await clickArrow(FEED);
check("clicking the arrow selects it", (await page.evaluate(() => Object.keys(window.__pcsPfd.api.getAppState().selectedElementIds))).includes(FEED));
await page.keyboard.press("Delete");
await settle(); await saved();
p = await stored();
check("deleted arrow's ID is retired", p.streams.retired.some((r) => r.streamId === "ST-100L-001"));
await page.keyboard.press("Control+z");
await settle(); await saved();
els = await scene();
p = await stored();
check("undo brings the same ID back", streamOf(els, FEED) === "ST-100L-001" && !p.streams.retired.some((r) => r.streamId === "ST-100L-001"), streamOf(els, FEED));

await clickArrow(FEED);
await page.keyboard.press("Control+d");
await settle();
els = await scene();
const dup = els.filter((e) => e.type === "arrow" && e.pcs?.streamId && ![FEED, SEG].includes(e.id));
check("a duplicated arrow gets a new ID", dup.length === 1 && dup[0].pcs.streamId === "ST-100L-002", dup.map((d) => d.pcs?.streamId).join(","));

// Material link on the bag
await page.getByRole("tab", { name: "Materials", exact: true }).click();
await page.getByRole("button", { name: "Add 33 sample materials" }).click();
await page.getByRole("tab", { name: "PFD", exact: true }).click();
await page.evaluate(() => {
  const api = window.__pcsPfd.api;
  const b = api.getSceneElements().find((e) => e.customData?.pcs?.symbol === "bag");
  const members = api.getSceneElements().filter((e) => e.groupIds?.includes(b.groupIds[0]));
  api.updateScene({ appState: { selectedElementIds: Object.fromEntries(members.map((m) => [m.id, true])), selectedGroupIds: { [b.groupIds[0]]: true } } });
});
await page.waitForTimeout(300);
await page.getByLabel("Material to link").selectOption({ label: "MAT-0017 · Single-use Bag 50 L (EA)" });
await page.getByRole("button", { name: "Link", exact: true }).click();
await page.getByLabel("Count").fill("2");
await settle();
check("material linked to the bag with a count", (await scene()).find((e) => e.pcs?.symbol === "bag").pcs.materials?.[0]?.qty === 2);

// Stream table of this drawing: its own streams and its transfers.
await select(null);
await page.getByRole("tab", { name: /^Streams/ }).click();
await page.getByRole("button", { name: "Insert stream table" }).click();
await settle();
els = await scene();
const st = els.find((e) => e.type === "image" && e.pcs?.table?.kind === "stream");
check("stream table lists this UO's streams and its transfer", st && JSON.stringify(st.pcs.table.rows.slice(1).map((r) => r[0])) === JSON.stringify(["ST-100L-001", "ST-100L-002", "ST-100L-HARVE"]),
  JSON.stringify(st?.pcs.table.rows.map((r) => r[0])));

// ---- the other end: HARVE drawing ---------------------------------------------------------------------
await openTab("HARVE");
els = await scene();
const [inn] = ports(els);
check("a connector for the incoming transfer, left of the frame", inn && inn.pcs.dir === "in" && textIn(els, inn.id) === "From 100L\nST-100L-HARVE" && inn.x + inn.width < els.find((e) => e.type === "frame").x,
  inn && JSON.stringify(textIn(els, inn.id)));
await insertSymbol("Depth filter");
await settle();
await fitView();
els = await scene();
const SEG2 = await drawArrow(centre(ports(els)[0]), centre(els.find((e) => e.pcs?.symbol === "depth")));
await settle();
check("arrow from the connector carries the transfer ID", streamOf(await scene(), SEG2) === "ST-100L-HARVE");

// ---- delete the transfer on the map: connectors in use say so; undo restores everything --------------
await openTab("Process map");
await fitView();
await clickArrow(TRANSFER);
await page.keyboard.press("Delete");
await settle(); await saved();
p = await stored();
check("deleting the transfer retires its ID", p.streams.retired.some((r) => r.streamId === "ST-100L-HARVE"));
const orphan = Object.values(p.pfd.sheets).flatMap((s) => s.elements).filter((e) => e.customData?.pcs?.port === "ST-100L-HARVE");
check("connectors with arrows stay, marked not connected", orphan.length === 2 && orphan.every((e) => e.customData.pcs.orphan === true), orphan.map((e) => JSON.stringify(e.customData.pcs)).join(" "));
await page.keyboard.press("Control+z");
await settle(); await saved();
p = await stored();
check("undo: the transfer gets its ID back", p.streams.active["ST-100L-HARVE"] && !p.streams.retired.some((r) => r.streamId === "ST-100L-HARVE"));
await openTab("100L");
els = await scene();
check("undo: the connector is connected again", ports(els).length === 1 && !ports(els)[0].pcs.orphan && textIn(els, ports(els)[0].id) === "To HARVE\nST-100L-HARVE" && streamOf(els, SEG) === "ST-100L-HARVE");

// ---- rename a UO from the panel; the frame, the box and the connectors follow -----------------------
await page.getByRole("tab", { name: /^Units/ }).click();
const code = page.getByLabel("UO code").nth(1);
await code.fill("CLAR");
await code.press("Enter");
await settle(); await saved();
els = await scene();
p = await stored();
{
  const clar = p.uos.find((u) => u.code === "CLAR");
  const fr = clar && p.pfd.sheets[clar.id].elements.find((e) => e.type === "frame");
  const bx = clar && p.pfd.map.elements.find((e) => e.customData?.pcs?.kind === "uo" && e.customData.pcs.uoId === clar.id);
  const bt = bx && p.pfd.map.elements.find((e) => e.containerId === bx.id);
  check("renamed code in the frame title and on the box", fr?.name === "CLAR · Harvest clarification" && bt?.originalText === "CLAR\nHarvest clarification", `${fr?.name} / ${JSON.stringify(bt?.originalText)}`);
}
check("…and on the connector here",textIn(els, ports(els)[0].id) === "To CLAR\nST-100L-HARVE", JSON.stringify(textIn(els, ports(els)[0].id)));
check("Stream IDs do not change with the code", streamOf(els, SEG) === "ST-100L-HARVE");
check("the tab shows the new code", (await tabs()).includes("CLAR") && (await tabTitles()).includes("CLAR · Harvest clarification"), (await tabs()).join(" | "));

// ---- add a unit operation from the tab bar, then delete it -------------------------------------------------
await page.locator(".sheet-tab.add").click();
await page.waitForFunction(() => window.__pcsPfd?.api);
await settle();
els = await scene();
check("'+ Unit operation' opens the new drawing with its frame", els.some((e) => e.type === "frame" && /^UNIT · Unit operation 3$|· Unit operation 3$/.test(e.name)), els.filter((e) => e.type === "frame").map((e) => e.name).join(","));
await page.getByRole("tab", { name: /^Units/ }).click();
await page.getByRole("button", { name: /^Delete UNIT|^Delete U/ }).last().click();
await page.getByRole("button", { name: "Delete unit operation" }).click();
await settle(); await saved();
p = await stored();
check("deleting a unit operation removes its box, drawing and tab", p.uos.length === 2 && Object.keys(p.pfd.sheets).length === 2 &&
  p.pfd.map.elements.filter((e) => e.customData?.pcs?.kind === "uo").length === 2 && (await tabs()).length === 4, `${p.uos.length} uos, ${(await tabs()).join(" | ")}`);

// ---- reload: everything survives -----------------------------------------------------------------------
await saved();
await page.reload();
await page.waitForFunction(() => window.__pcsPfd?.api);
await settle();
p = await stored();
check("after reload: UOs, drawings and IDs kept", p.uos.length === 2 && JSON.stringify(Object.keys(p.streams.active).sort()) === JSON.stringify(["ST-100L-001", "ST-100L-002", "ST-100L-HARVE"]),
  Object.keys(p.streams.active).join(","));
await openTab("100L");
els = await scene();
check("after reload: the 100L drawing is as it was", streamOf(els, FEED) === "ST-100L-001" && textIn(els, SEG) === "ST-100L-HARVE\nHarvest to clarification");

// A change made just before the page closes is still saved (flushed on pagehide).
const movedTo = await page.evaluate(() => {
  const api = window.__pcsPfd.api;
  const all = api.getSceneElementsIncludingDeleted();
  const t = all.find((e) => !e.isDeleted && e.customData?.pcs?.table?.kind === "stream");
  api.updateScene({ elements: all.map((e) => (e.id === t.id ? { ...e, x: e.x + 123, version: e.version + 1 } : e)) });
  return { id: t.id, x: t.x + 123 };
});
await page.waitForTimeout(50);
await page.reload();
await page.waitForFunction(() => window.__pcsPfd?.api);
await settle();
await openTab("100L");
const tx = await page.evaluate((id) => window.__pcsPfd.api.getSceneElements().find((e) => e.id === id)?.x, movedTo.id);
check("a last-second change survives closing the page", Math.abs(tx - movedTo.x) < 0.01, `${tx} vs ${movedTo.x}`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
