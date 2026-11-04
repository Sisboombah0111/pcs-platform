// Builds examples/example-downstream.pcs.json by drawing it in the app, the way a user would:
// a mAb downstream process from harvested culture fluid (HCCF) of a 15,000 L bioreactor (Receiving) or
// 2,000 L (Sending): Protein A with low-pH viral inactivation and depth filtration (PROA), cation exchange
// (CEX), mixed-mode flow-through (MMC), virus filtration (VF), UF/DF and formulation (UFDF), bulk fill
// (FILL) and frozen storage at -70 °C (STOR).
//   Materials   imported from examples/downstream-materials.xlsx (with the Recipes and Backups sheets)
//   PFD         process map with the six transfers (a transfer line linked on each), and per unit
//               operation its symbols (buffer bags relabelled with their buffer), named streams and links
//   MB          examples/MB_downstream.xlsx uploaded and applied
//   BOM         resins as manual lines (packed bed volume per scenario, with the reason)
// Usage: LANG=C.UTF-8 node tools/make-downstream-project.mjs <base-url of a built app> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } }); // draw with the guide closed
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const wait = (ms) => page.waitForTimeout(ms);
const ex = (f) => resolve("examples", f);
await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForFunction(() => window.__pcsPfd?.api);

// ---- new project, materials from the downstream material file -------------------------------------------------
await page.getByRole("button", { name: "New", exact: true }).click();
await page.locator(".dialog input.search").fill("Downstream example (mAb, 15,000 L)");
await page.locator(".dialog input[type=checkbox]").uncheck();
await page.getByRole("button", { name: "Create", exact: true }).click();
const discard = page.getByRole("button", { name: "Start new without saving" });
if (await discard.isVisible({ timeout: 1500 }).catch(() => false)) await discard.click();
await wait(800);
await page.getByRole("tab", { name: /^Materials/ }).click();
await wait(400);
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Import Excel/CSV" }).first().click()]);
  await chooser.setFiles(ex("downstream-materials.xlsx"));
  await wait(1200);
  console.log((await page.locator(".dialog .toolbar").innerText()).replace(/\n/g, " | "));
  await page.locator(".dialog").getByRole("button", { name: /^Apply/ }).click();
  await wait(600);
}
await page.getByRole("tab", { name: "PFD", exact: true }).click();
await page.waitForFunction(() => window.__pcsPfd?.api);
await wait(600);

// ---- helpers (as in make-example-project.mjs, plus top/bottom edges, connectors by direction, labels) -----------
const openTab = async (code) => {
  await page.locator(".sheet-tab", { hasText: code === "map" ? "Process map" : new RegExp(`^\\s*${code}\\b`) }).first().click();
  await page.waitForFunction(() => window.__pcsPfd?.api);
  await wait(900);
};
const nameSelected = async (id, name) => {
  await page.evaluate((id) => window.__pcsPfd.api.updateScene({ appState: { selectedElementIds: { [id]: true } } }), id);
  await wait(300);
  await page.getByPlaceholder("e.g. Basal media feed").fill(name);
  await page.getByPlaceholder("e.g. Basal media feed").press("Enter");
  await wait(600);
};
const fitView = (zoom) => page.evaluate((zoom) => {
  const api = window.__pcsPfd.api;
  const els = api.getSceneElements();
  const minX = Math.min(...els.map((e) => e.x)), maxX = Math.max(...els.map((e) => e.x + e.width));
  const minY = Math.min(...els.map((e) => e.y)), maxY = Math.max(...els.map((e) => e.y + e.height));
  const st = api.getAppState();
  const z = zoom ?? Math.min(1, (st.width - 360) / (maxX - minX + 80), (st.height - 80) / (maxY - minY + 80));
  api.updateScene({ appState: { zoom: { value: z }, scrollX: 320 / z - minX, scrollY: st.height / 2 / z - (minY + maxY) / 2, selectedElementIds: {} } });
}, zoom).then(() => wait(500));
const toScreen = (pt) => page.evaluate((pt) => {
  const st = window.__pcsPfd.api.getAppState();
  return { x: (pt.x + st.scrollX) * st.zoom.value + st.offsetLeft, y: (pt.y + st.scrollY) * st.zoom.value + st.offsetTop };
}, pt);
/** A point just inside one side of an element, `frac` of the way along that side. */
const edge = (find, side, frac) => page.evaluate(({ find, side, frac }) => {
  const els = window.__pcsPfd.api.getSceneElements();
  // A symbol: the bounds of its drawn parts (not its label; line points count, wherever the line starts).
  const groupBounds = (g) => {
    const parts = els.filter((e) => e.groupIds?.includes(g) && e.type !== "text");
    const xs = [], ys = [];
    for (const e of parts) {
      if (e.points) for (const [px, py] of e.points) { xs.push(e.x + px); ys.push(e.y + py); }
      else { xs.push(e.x, e.x + e.width); ys.push(e.y, e.y + e.height); }
    }
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  };
  const b = find.group ? groupBounds(find.group)
    : find.port ? els.find((e) => e.customData?.pcs?.port && e.customData.pcs.dir === find.port) : els.find((e) => e.id === find.id);
  if (!b) throw new Error(`not found: ${JSON.stringify(find)}; ports: ${JSON.stringify(els.filter((e) => e.customData?.pcs?.port).map((e) => e.customData.pcs))}`);
  if (side === "left" || side === "right") return { x: side === "right" ? b.x + b.width - 3 : b.x + 3, y: b.y + b.height * frac };
  return { x: b.x + b.width * frac, y: side === "bottom" ? b.y + b.height - 3 : b.y + 3 };
}, { find, side, frac }).then(toScreen);
const arrowIds = () => page.evaluate(() => window.__pcsPfd.api.getSceneElements().filter((e) => e.type === "arrow").map((e) => e.id));
const draw = async ([fFind, fs, ff], [tFind, ts, tf]) => {
  const before = await arrowIds();
  await page.locator('[data-testid="toolbar-arrow"]').click({ force: true });
  // Straight arrows: buffer lines fan in to a column and keep their labels apart (the app's default is elbow).
  await page.evaluate(() => window.__pcsPfd.api.updateScene({ appState: { currentItemArrowType: "sharp" } }));
  const a = await edge(fFind, fs, ff), b = await edge(tFind, ts, tf);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await wait(800);
  return (await arrowIds()).find((id) => !before.includes(id));
};
/** Insert symbols into the drawing's frame, then move each to its place: [symbol, centre x, centre y in the frame, key, label?]. */
const placeSymbols = async (layout) => {
  const groups = {};
  for (const [symbol, , , key] of layout) {
    await page.evaluate(() => { const api = window.__pcsPfd.api; api.scrollToContent(api.getSceneElements().find((e) => e.type === "frame"), { fitToViewport: true, viewportZoomFactor: 0.8, animate: false }); });
    await page.getByRole("tab", { name: "Symbols" }).click();
    await page.getByRole("button", { name: symbol, exact: true }).click();
    await wait(350);
    groups[key] = await page.evaluate(() => Object.keys(window.__pcsPfd.api.getAppState().selectedGroupIds)[0]);
  }
  await page.evaluate(({ layout, groups }) => {
    const api = window.__pcsPfd.api;
    const all = api.getSceneElementsIncludingDeleted();
    const frame = all.find((e) => e.type === "frame" && !e.isDeleted);
    const moves = new Map();
    for (const [, cx, cy, key] of layout) {
      const g = groups[key];
      const body = all.find((e) => e.groupIds?.includes(g) && e.customData?.pcs?.symbol);
      const dx = frame.x + cx - (body.x + body.width / 2), dy = frame.y + cy - (body.y + body.height / 2);
      for (const e of all) if (e.groupIds?.includes(g)) moves.set(e.id, { dx, dy });
    }
    api.updateScene({ elements: all.map((e) => { const m = moves.get(e.id); return m ? { ...e, x: e.x + m.dx, y: e.y + m.dy, frameId: frame.id, version: e.version + 1 } : e; }) });
  }, { layout, groups });
  await wait(500);
  // Labels: the text under a symbol is plain text in its group; buffer bags get their buffer's code and use.
  for (const [, , , key, label] of layout) {
    if (!label) continue;
    await page.evaluate(({ g, text }) => {
      const api = window.__pcsPfd.api;
      const all = api.getSceneElementsIncludingDeleted();
      const mine = all.filter((e) => !e.isDeleted && e.groupIds?.includes(g));
      const body = mine.find((e) => e.customData?.pcs?.symbol);
      const old = mine.filter((e) => e.type === "text" && !e.containerId).sort((a, b) => b.y - a.y)[0];
      const [t] = window.__pcsPfd.convert([{ type: "text", x: 0, y: old.y, text, fontSize: 14, fontFamily: old.fontFamily, strokeColor: old.strokeColor, textAlign: "center" }], { regenerateIds: true });
      const next = { ...t, x: body.x + body.width / 2 - t.width / 2, y: old.y, groupIds: old.groupIds, frameId: old.frameId };
      api.updateScene({ elements: [...all.map((e) => (e.id === old.id ? { ...e, isDeleted: true, version: e.version + 1 } : e)), next] });
    }, { g: groups[key], text: label });
  }
  await wait(500);
  return groups;
};
const selectGroup = (group) => page.evaluate((g) => {
  const api = window.__pcsPfd.api;
  const members = api.getSceneElements().filter((e) => e.groupIds?.includes(g));
  api.updateScene({ appState: { selectedElementIds: Object.fromEntries(members.map((m) => [m.id, true])), selectedGroupIds: { [g]: true } } });
}, group);
const linkSelected = async (label) => {
  await wait(300);
  await page.getByLabel("Material to link").selectOption({ label });
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await wait(500);
};
const linkGroup = async (group, label) => { await selectGroup(group); await linkSelected(label); };
const linkArrow = async (id, label) => { await page.evaluate((id) => window.__pcsPfd.api.updateScene({ appState: { selectedElementIds: { [id]: true } } }), id); await linkSelected(label); };
/** Draw the arrows in order (Stream IDs follow the order) and name the ones that become streams. */
const streams = async (list) => {
  const out = [];
  for (const [from, to, name] of list) {
    const id = await draw(from, to);
    if (name) await nameSelected(id, name);
    out.push(id);
  }
  return out;
};
const resizeFrame = (w, h) => page.evaluate(({ w, h }) => {
  const api = window.__pcsPfd.api;
  api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (e.type === "frame" && !e.isDeleted ? { ...e, width: w, height: h, version: e.version + 1 } : e)) });
}, { w, h }).then(() => wait(600));
const snap = async (name) => { if (shot) { await fitView(); await wait(400); await page.screenshot({ path: `${shot}-${name}.png` }); } };

// ---- unit operations, their codes and drawing sizes -------------------------------------------------------------
const UOS = [
  ["PROA", "Protein A, VI, depth filtration", 1150, 760],
  ["CEX", "Cation exchange", 1100, 1100],
  ["MMC", "Mixed-mode chromatography", 1050, 760],
  ["VF", "Virus filtration", 880, 560],
  ["UFDF", "UF/DF and formulation", 1100, 820],
  ["FILL", "Bulk fill", 900, 580],
  ["STOR", "Frozen storage -70 °C", 620, 400],
];
await page.getByRole("tab", { name: /^Units/ }).click();
for (const [, name] of UOS) {
  await page.getByLabel("New unit operation name").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await wait(600);
}
for (const [want, name] of UOS) {
  // Rows may reorder after a rename: find the row by its name every time.
  const i = await page.getByLabel("UO name").evaluateAll((els, name) => els.findIndex((e) => e.value === name), name);
  const code = page.getByLabel("UO code").nth(i);
  await code.fill(want);
  await code.press("Enter");
  await wait(500);
}
for (const [code, , w, h] of UOS) { await openTab(code); await resizeFrame(w, h); }

// ---- process map: the six transfers, a transfer line linked on each ------------------------------------------------
await openTab("map");
// The boxes in process order, in one row (each box with its text).
const boxes = await page.evaluate((codes) => {
  const api = window.__pcsPfd.api;
  const all = api.getSceneElementsIncludingDeleted();
  const live = all.filter((e) => !e.isDeleted);
  const boxOf = (code) => live.find((b) => b.customData?.pcs?.kind === "uo" && live.some((t) => t.containerId === b.id && (t.originalText ?? t.text).split("\n")[0].trim() === code));
  const order = codes.map(boxOf);
  const moves = new Map();
  // One row: the unit operations' order follows the map from left to right.
  order.forEach((b, i) => {
    const dx = i * 400 - b.x, dy = 0 - b.y;
    moves.set(b.id, { dx, dy });
    for (const t of live) if (t.containerId === b.id) moves.set(t.id, { dx, dy });
  });
  api.updateScene({ elements: all.map((e) => { const m = moves.get(e.id); return m ? { ...e, x: e.x + m.dx, y: e.y + m.dy, version: e.version + 1 } : e; }) });
  return order.map((b) => b.id);
}, UOS.map((u) => u[0]));
await wait(600);
await fitView();
const TRANSFERS = ["Depth filtrate", "CEX pool", "MMC flow-through", "Virus filtrate", "Formulated bulk", "Filled bottles"];
const SIDES = TRANSFERS.map(() => ["right", "left"]);
for (let i = 0; i < TRANSFERS.length; i++) {
  const id = await draw([{ id: boxes[i] }, SIDES[i][0], 0.5], [{ id: boxes[i + 1] }, SIDES[i][1], 0.5]);
  await nameSelected(id, TRANSFERS[i]);
  await linkArrow(id, 'LIN-0001 · Transfer line 1.5", 2 m (EA)');
}

// ---- PROA: Protein A capture, low-pH viral inactivation, depth filtration ---------------------------------------------
await openTab("PROA");
let g = await placeSymbols([
  ["Off-page reference", 110, 80, "hccf", "HCCF from harvest"],
  ["Single-use bag", 110, 225, "eq", "BUF-1001\nEquilibration"],
  ["Single-use bag", 110, 365, "wash", "BUF-1002\nWash"],
  ["Single-use bag", 110, 505, "elu", "BUF-1003\nElution"],
  ["Single-use bag", 110, 645, "naoh", "BUF-1006\n0.5 M NaOH"],
  ["Protein A column", 420, 360, "col", "Protein A column"],
  ["Drain", 420, 680, "drain"],
  ["Low-pH viral inactivation", 660, 360, "vi", "Low-pH VI"],
  ["Single-use bag", 560, 70, "acid", "BUF-1004\n1 M acetic acid"],
  ["Single-use bag", 770, 70, "base", "BUF-1005\n1 M Tris"],
  ["Depth filter", 880, 360, "depth", "Depth filter"],
  ["WFI point of use", 880, 650, "wfi", "WFI"],
  ["Sterile filter (0.2 µm)", 1040, 360, "st", "0.2 µm filter"],
]);
await fitView();
await streams([
  [[{ group: g.hccf }, "right", 0.5], [{ group: g.col }, "left", 0.15], "HCCF load"],
  [[{ group: g.eq }, "right", 0.5], [{ group: g.col }, "left", 0.35], "Equilibration and wash buffer"],
  [[{ group: g.wash }, "right", 0.5], [{ group: g.col }, "left", 0.55], "Intermediate wash buffer"],
  [[{ group: g.elu }, "right", 0.5], [{ group: g.col }, "left", 0.75], "Elution buffer"],
  [[{ group: g.naoh }, "right", 0.5], [{ group: g.col }, "left", 0.92], "Sanitization"],
  [[{ group: g.col }, "bottom", 0.5], [{ group: g.drain }, "top", 0.5], "Column waste"],
  [[{ group: g.col }, "right", 0.5], [{ group: g.vi }, "left", 0.5], "Protein A eluate"],
  [[{ group: g.acid }, "right", 0.5], [{ group: g.vi }, "top", 0.3], "VI titrant"],
  [[{ group: g.base }, "left", 0.5], [{ group: g.vi }, "top", 0.7], "Neutralization"],
  [[{ group: g.vi }, "right", 0.5], [{ group: g.depth }, "left", 0.5], "Neutralized VI pool"],
  [[{ group: g.wfi }, "top", 0.5], [{ group: g.depth }, "bottom", 0.5], "Depth filter flush"],
  [[{ group: g.depth }, "right", 0.5], [{ group: g.st }, "left", 0.5], "Depth filtrate"],
  [[{ group: g.st }, "right", 0.5], [{ port: "out" }, "left", 0.5]],
]);
await linkGroup(g.st, 'FLT-0002 · Sterile filter capsule 0.2 µm (10") (EA)');
await snap("PROA");

// ---- CEX: load dilution, cation exchange bind-elute ----------------------------------------------------------------------
await openTab("CEX");
g = await placeSymbols([
  ["WFI point of use", 220, 170, "wfi", "WFI"],
  ["Hold vessel", 220, 430, "tank", "CEX load tank"],
  ["Ion exchange column (AEX / CEX)", 560, 420, "col", "CEX column"],
  ["Drain", 560, 960, "drain"],
  ["Single-use bag", 900, 590, "eq", "BUF-2001\nEquil. / wash"],
  ["Single-use bag", 900, 735, "elu", "BUF-2002\nElution"],
  ["Single-use bag", 900, 880, "strip", "BUF-2003\nStrip"],
  ["Single-use bag", 900, 1025, "naoh", "BUF-1006\n0.5 M NaOH"],
]);
await fitView();
const cex = await streams([
  [[{ port: "in" }, "right", 0.5], [{ group: g.tank }, "left", 0.5]],
  [[{ group: g.wfi }, "bottom", 0.5], [{ group: g.tank }, "top", 0.5], "Load dilution"],
  [[{ group: g.tank }, "right", 0.5], [{ group: g.col }, "left", 0.5], "CEX load"],
  [[{ group: g.eq }, "left", 0.5], [{ group: g.col }, "right", 0.55], "Equilibration and wash buffer"],
  [[{ group: g.elu }, "left", 0.5], [{ group: g.col }, "right", 0.68], "Elution buffer"],
  [[{ group: g.strip }, "left", 0.5], [{ group: g.col }, "right", 0.81], "Strip"],
  [[{ group: g.naoh }, "left", 0.5], [{ group: g.col }, "right", 0.94], "Sanitization"],
  [[{ group: g.col }, "bottom", 0.5], [{ group: g.drain }, "top", 0.5], "Column waste"],
  [[{ group: g.col }, "right", 0.2], [{ port: "out" }, "left", 0.5]],
]);
await linkArrow(cex[2], 'FLT-0002 · Sterile filter capsule 0.2 µm (10") (EA)');
await snap("CEX");

// ---- MMC: load pH adjustment, mixed-mode flow-through ----------------------------------------------------------------------
await openTab("MMC");
g = await placeSymbols([
  ["Single-use bag", 220, 130, "base", "BUF-1005\n1 M Tris"],
  ["Hold vessel", 220, 380, "tank", "MMC load tank"],
  ["HIC / mixed-mode column", 560, 370, "col", "Mixed-mode column"],
  ["Drain", 560, 680, "drain"],
  ["Single-use bag", 880, 470, "eq", "BUF-3001\nEquil. / chase"],
  ["Single-use bag", 880, 620, "naoh", "BUF-1006\n0.5 M NaOH"],
]);
await fitView();
const mmc = await streams([
  [[{ port: "in" }, "right", 0.5], [{ group: g.tank }, "left", 0.5]],
  [[{ group: g.base }, "bottom", 0.5], [{ group: g.tank }, "top", 0.5], "Load pH adjustment"],
  [[{ group: g.tank }, "right", 0.5], [{ group: g.col }, "left", 0.5], "MMC load"],
  [[{ group: g.eq }, "left", 0.5], [{ group: g.col }, "right", 0.6], "Equilibration and chase buffer"],
  [[{ group: g.naoh }, "left", 0.5], [{ group: g.col }, "right", 0.85], "Sanitization"],
  [[{ group: g.col }, "bottom", 0.5], [{ group: g.drain }, "top", 0.5], "Column waste"],
  [[{ group: g.col }, "right", 0.2], [{ port: "out" }, "left", 0.5]],
]);
await linkArrow(mmc[2], 'FLT-0002 · Sterile filter capsule 0.2 µm (10") (EA)');
await snap("MMC");

// ---- VF: prefilter and virus filter --------------------------------------------------------------------------------------
await openTab("VF");
g = await placeSymbols([
  ["Prefilter", 260, 270, "pre", "Prefilter"],
  ["Virus filter", 540, 270, "vf", "Virus filter"],
  ["Single-use bag", 260, 470, "buf", "BUF-3001\nFlush / chase"],
  ["Drain", 540, 480, "drain"],
]);
await fitView();
await streams([
  [[{ port: "in" }, "right", 0.5], [{ group: g.pre }, "left", 0.5]],
  [[{ group: g.pre }, "right", 0.5], [{ group: g.vf }, "left", 0.5], "Prefiltrate"],
  [[{ group: g.buf }, "top", 0.5], [{ group: g.pre }, "bottom", 0.5], "Flush and chase buffer"],
  [[{ group: g.vf }, "bottom", 0.5], [{ group: g.drain }, "top", 0.5], "Filter flush to drain"],
  [[{ group: g.vf }, "right", 0.5], [{ port: "out" }, "left", 0.5]],
]);
await snap("VF");

// ---- UFDF: UF/DF, excipient spike, 0.2 µm filtration -----------------------------------------------------------------------
await openTab("UFDF");
g = await placeSymbols([
  ["Single-use bag", 130, 80, "naoh", "BUF-1006\n0.5 M NaOH"],
  ["Single-use bag", 130, 225, "flush", "BUF-5001\nFlush / chase"],
  ["TFF / UF-DF", 430, 150, "tff", "UF/DF system"],
  ["Drain", 760, 150, "drain"],
  ["Hold vessel", 430, 420, "tank", "Retentate tank"],
  ["Single-use bag", 130, 570, "df", "BUF-5001\nDF buffer"],
  ["Single-use bag", 130, 720, "spike", "BUF-5002\nExcipient stock"],
  ["Sterile filter (0.2 µm)", 790, 420, "st", "0.2 µm filter"],
]);
await fitView();
await streams([
  [[{ port: "in" }, "right", 0.5], [{ group: g.tank }, "left", 0.25]],
  [[{ group: g.tank }, "top", 0.5], [{ group: g.tff }, "bottom", 0.5], "UF feed"],
  [[{ group: g.tff }, "right", 0.5], [{ group: g.drain }, "left", 0.5], "Permeate"],
  [[{ group: g.df }, "right", 0.5], [{ group: g.tank }, "left", 0.65], "Diafiltration buffer"],
  [[{ group: g.spike }, "right", 0.5], [{ group: g.tank }, "left", 0.92], "Excipient spike"],
  [[{ group: g.flush }, "right", 0.5], [{ group: g.tff }, "left", 0.75], "Flush and recovery chase"],
  [[{ group: g.naoh }, "right", 0.5], [{ group: g.tff }, "left", 0.25], "Sanitization"],
  [[{ group: g.tank }, "right", 0.5], [{ group: g.st }, "left", 0.5], "Formulated bulk"],
  [[{ group: g.st }, "right", 0.5], [{ port: "out" }, "left", 0.5]],
]);
await linkGroup(g.st, 'FLT-0002 · Sterile filter capsule 0.2 µm (10") (EA)');
await snap("UFDF");

// ---- FILL: bulk fill into bottles ------------------------------------------------------------------------------------------
await openTab("FILL");
g = await placeSymbols([
  ["Sterile filter (0.2 µm)", 250, 250, "st", "Bulk fill filter"],
  ["Filling (fill-finish)", 500, 250, "fill", "Bulk fill"],
  ["Bulk drug substance", 740, 250, "bds", "Bulk DS bottles"],
  ["Single-use bag", 250, 500, "buf", "BUF-5001\nFilter flush"],
]);
await fitView();
await streams([
  [[{ port: "in" }, "right", 0.5], [{ group: g.st }, "left", 0.5]],
  [[{ group: g.st }, "right", 0.5], [{ group: g.fill }, "left", 0.5], "Filtered bulk"],
  [[{ group: g.buf }, "top", 0.5], [{ group: g.st }, "bottom", 0.5], "Filter flush"],
  [[{ group: g.fill }, "right", 0.5], [{ group: g.bds }, "left", 0.5], "Filled bottles"],
  [[{ group: g.bds }, "right", 0.5], [{ port: "out" }, "left", 0.5]],
]);
await linkGroup(g.st, 'FLT-0006 · Bulk fill filter 0.2 µm (5") (EA)');
await linkGroup(g.fill, "CON-0002 · Bulk fill manifold (single-use) (EA)");
await snap("FILL");

// ---- STOR: -70 °C freezer ---------------------------------------------------------------------------------------------------
await openTab("STOR");
g = await placeSymbols([["Freezer / freeze-thaw", 330, 200, "frz", "-70 °C freezer"]]);
await fitView();
await streams([[[{ port: "in" }, "right", 0.5], [{ group: g.frz }, "left", 0.5]]]);
await linkGroup(g.frz, "CON-0003 · Temperature data logger (EA)");
await snap("STOR");

await openTab("map");
await snap("map");
const ids = await page.evaluate(() => window.__pcsPfd.all().filter((e) => e.customData?.pcs?.streamId && !e.customData.pcs.segment)
  .map((e) => `${e.customData.pcs.streamId} ${e.customData.pcs.name ?? ""}`).sort());
console.log(ids.join("\n"));

// ---- Mass Balance: apply the downstream workbook ------------------------------------------------------------------------
await page.getByRole("tab", { name: "Mass Balance", exact: true }).click();
await wait(600);
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload Excel workbook…" }).click()]);
  await chooser.setFiles(ex("MB_downstream.xlsx"));
  await wait(1500);
}
await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
await wait(1500);
console.log("link check:", (await page.locator(".link-chip").innerText()).trim());

// ---- BOM: resins as manual lines (packed bed volume; reused over many batches) ---------------------------------------------
await page.getByRole("tab", { name: "BOM", exact: true }).click();
await wait(800);
for (const [uo, code, label, s, r] of [
  ["PROA", "RES-0001", "RES-0001 · Protein A resin (L)", 60, 330],
  ["CEX", "RES-0002", "RES-0002 · Cation exchange resin (L)", 50, 300],
  ["MMC", "RES-0003", "RES-0003 · Mixed-mode resin (L)", 50, 320],
]) {
  await page.getByLabel(`Material to add to ${uo}`).selectOption({ label });
  await page.locator(`section[aria-label='BOM ${uo}']`).getByRole("button", { name: "Add", exact: true }).click();
  await wait(400);
  for (const [l, v] of [[`Sending of ${code}`, String(s)], [`Receiving of ${code}`, String(r)], [`Note for ${code}`, "Packed bed volume (MB_calc); the resin is reused over many batches"]]) {
    await page.getByLabel(l).fill(v);
    await page.getByLabel(l).press("Enter");
    await wait(250);
  }
}
console.log("BOM:", await page.locator(".page-head .toolbar").innerText());
if (shot) await page.screenshot({ path: `${shot}-bom.png` });

const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
copyFileSync(await download.path(), "examples/example-downstream.pcs.json");
console.log("wrote examples/example-downstream.pcs.json", errors.length ? `page errors: ${errors.join(" | ")}` : "");
await browser.close();
