// Builds examples/example-process.pcs.json by drawing it in the app, the way a user would:
// two unit operations (10L seed, 100L fed-batch) on the process map with the transfer between them,
// and in each unit operation's own drawing its symbols, streams with names, the arrows to and from the
// transfer's connectors, and bags linked to the sample bag materials (MAT-0017, MAT-0018). A stream
// table sits on the process map. Its Stream IDs match the example MB workbooks (examples/MB_example*.xlsx).
// Usage: LANG=C.UTF-8 node tools/make-example-project.mjs <base-url of a built app> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { copyFileSync } from "node:fs";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } }); // draw with the guide closed
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForFunction(() => window.__pcsPfd?.api);

// New project with the sample materials.
await page.getByRole("button", { name: "New", exact: true }).click();
await page.locator(".dialog input.search").fill("Example process");
await page.getByRole("button", { name: "Create", exact: true }).click();
const discard = page.getByRole("button", { name: "Start new without saving" });
if (await discard.isVisible({ timeout: 1500 }).catch(() => false)) await discard.click();
await wait(800);
await page.waitForFunction(() => window.__pcsPfd?.api);
await wait(500);

const openTab = async (text) => {
  await page.locator(".sheet-tab", { hasText: text }).first().click();
  await page.waitForFunction(() => window.__pcsPfd?.api);
  await wait(900);
};
const nameSelected = async (id, name) => {
  await page.evaluate((id) => window.__pcsPfd.api.updateScene({ appState: { selectedElementIds: { [id]: true } } }), id);
  await wait(300);
  await page.getByPlaceholder("e.g. Basal media feed").fill(name);
  await page.getByPlaceholder("e.g. Basal media feed").press("Enter");
  await wait(700);
};
/** Fit the drawing at `zoom`, right of Excalidraw's property panel. */
const fitView = (zoom = 0.6) => page.evaluate((zoom) => {
  const api = window.__pcsPfd.api;
  const els = api.getSceneElements();
  const minX = Math.min(...els.map((e) => e.x)), minY = Math.min(...els.map((e) => e.y)), maxY = Math.max(...els.map((e) => e.y + e.height));
  const st = api.getAppState();
  api.updateScene({ appState: { zoom: { value: zoom }, scrollX: 300 / zoom - minX, scrollY: st.height / 2 / zoom - (minY + maxY) / 2, selectedElementIds: {} } });
}, zoom).then(() => wait(500));
const toScreen = (pt) => page.evaluate((pt) => {
  const st = window.__pcsPfd.api.getAppState();
  return { x: (pt.x + st.scrollX) * st.zoom.value + st.offsetLeft, y: (pt.y + st.scrollY) * st.zoom.value + st.offsetTop };
}, pt);
/** A point just inside an element's left or right edge, `frac` of the way down: the arrow binds to that side. */
const edge = (find, side, frac) => page.evaluate(({ find, side, frac }) => {
  const els = window.__pcsPfd.api.getSceneElements();
  const b = find.group ? els.find((e) => e.groupIds?.includes(find.group) && e.customData?.pcs?.symbol)
    : find.port ? els.find((e) => e.customData?.pcs?.port) : els.find((e) => e.id === find.id);
  const x = side === "right" ? b.x + b.width - 3 : side === "left" ? b.x + 3 : b.x + b.width / 2;
  return { x, y: b.y + b.height * frac };
}, { find, side, frac }).then(toScreen);
const arrowIds = () => page.evaluate(() => window.__pcsPfd.api.getSceneElements().filter((e) => e.type === "arrow").map((e) => e.id));
const draw = async ([fFind, fs, ff], [tFind, ts, tf]) => {
  const before = await arrowIds();
  await page.locator('[data-testid="toolbar-arrow"]').click({ force: true });
  const a = await edge(fFind, fs, ff), b = await edge(tFind, ts, tf);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await wait(900);
  return (await arrowIds()).find((id) => !before.includes(id));
};
/** Insert symbols into the drawing's frame, then move each to its place: [symbol, centre x, centre y in the frame, key]. */
const placeSymbols = async (layout) => {
  const groups = {};
  for (const [symbol, , , key] of layout) {
    await page.evaluate(() => { const api = window.__pcsPfd.api; api.scrollToContent(api.getSceneElements().find((e) => e.type === "frame"), { fitToViewport: true, viewportZoomFactor: 0.8, animate: false }); });
    await page.getByRole("tab", { name: "Symbols" }).click();
    await page.getByRole("button", { name: symbol, exact: true }).click();
    await wait(400);
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
  await wait(600);
  return groups;
};
const link = async (group, label) => {
  await page.evaluate((g) => {
    const api = window.__pcsPfd.api;
    const members = api.getSceneElements().filter((e) => e.groupIds?.includes(g));
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries(members.map((m) => [m.id, true])), selectedGroupIds: { [g]: true } } });
  }, group);
  await wait(300);
  await page.getByLabel("Material to link").selectOption({ label });
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await wait(500);
};

// ---- process map: two unit operations and the transfer between them ----------------------------------
await page.getByRole("tab", { name: /^Units/ }).click();
for (const name of ["10L Seed bioreactor", "100L Bioreactor"]) {
  await page.getByLabel("New unit operation name").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await wait(700);
}
await fitView(0.8);
const boxes = await page.evaluate(() => window.__pcsPfd.api.getSceneElements().filter((e) => e.customData?.pcs?.kind === "uo").sort((a, b) => a.x - b.x).map((e) => e.id));
const transfer = await draw([{ id: boxes[0] }, "right", 0.5], [{ id: boxes[1] }, "left", 0.5]);
await nameSelected(transfer, "Inoculum transfer");

// ---- 10L drawing --------------------------------------------------------------------------------------------
await openTab("10L 10L");
const g10 = await placeSymbols([["Single-use bag", 170, 215, "seed"], ["Bioreactor", 450, 215, "bio10"]]);
await fitView();
await nameSelected(await draw([{ group: g10.seed }, "right", 0.5], [{ group: g10.bio10 }, "left", 0.5]), "Seed medium");
await draw([{ group: g10.bio10 }, "right", 0.5], [{ port: true }, "left", 0.5]);
await link(g10.seed, "MAT-0017 · Single-use Bag 50 L (EA)");
await fitView(0.75);
if (shot) await page.screenshot({ path: `${shot}-10L.png` });

// ---- 100L drawing --------------------------------------------------------------------------------------------
await openTab("100L 100L");
const g100 = await placeSymbols([["Bioreactor", 220, 215, "bio100"], ["Single-use bag", 480, 125, "basal"], ["Single-use bag", 480, 305, "feed"]]);
await fitView();
await draw([{ port: true }, "right", 0.5], [{ group: g100.bio100 }, "left", 0.5]);
await nameSelected(await draw([{ group: g100.basal }, "left", 0.5], [{ group: g100.bio100 }, "right", 0.3]), "Basal medium");
await nameSelected(await draw([{ group: g100.feed }, "left", 0.5], [{ group: g100.bio100 }, "right", 0.7]), "Feed A");
await link(g100.basal, "MAT-0018 · Single-use Bag 500 L (EA)");
await link(g100.feed, "MAT-0017 · Single-use Bag 50 L (EA)");
await fitView(0.75);
if (shot) await page.screenshot({ path: `${shot}-100L.png` });

// ---- stream table on the process map --------------------------------------------------------------------------
await openTab("Process map");
await page.evaluate(() => window.__pcsPfd.api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} } }));
await page.getByRole("tab", { name: /^Streams/ }).click();
await page.getByRole("button", { name: "Insert stream table" }).click();
await wait(1000);
await page.evaluate(() => {
  const api = window.__pcsPfd.api;
  api.updateScene({ appState: { selectedElementIds: {} } });
  api.scrollToContent(api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.7, animate: false });
});
await wait(1500);
if (shot) await page.screenshot({ path: `${shot}-map.png` });

const ids = await page.evaluate(() => window.__pcsPfd.all().filter((e) => (e.customData?.pcs?.streamId && !e.customData.pcs.segment) || e.customData?.pcs?.materials)
  .map((e) => e.customData.pcs.streamId ? `${e.customData.pcs.streamId} ${e.customData.pcs.name}` : `link ${JSON.stringify(e.customData.pcs.materials.map((m) => m.qty))}`).sort());
console.log(ids.join("\n"));
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
copyFileSync(await download.path(), "examples/example-process.pcs.json");
console.log("wrote examples/example-process.pcs.json", errors.length ? `page errors: ${errors.join(" | ")}` : "");
await browser.close();
