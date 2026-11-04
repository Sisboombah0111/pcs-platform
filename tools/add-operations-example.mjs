// Adds the PROA steps to examples/example-downstream.pcs.json the way a user would: tags on four PFD
// shapes (C-101 column, T-101 VI vessel, F-101 depth filter, F-102 0.2 µm filter), then Operations ›
// Import from Excel with examples/operations-downstream.xlsx (tools/make-operations-example.mjs).
// Run after tools/make-downstream-project.mjs.
// Usage: LANG=C.UTF-8 node tools/add-operations-example.mjs <base-url of a built app> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); localStorage.removeItem("pcs.ops.uo"); localStorage.removeItem("pcs.ops.view"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const wait = (ms) => page.waitForTimeout(ms);
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

// ---- tags on the PFD shapes ------------------------------------------------------------------------------------------------
await page.locator(".sheet-tab", { hasText: /^\s*PROA\b/ }).first().click();
await page.waitForFunction(() => window.__pcsPfd?.api);
await wait(1000);
for (const [symbol, tag] of [["proa", "C-101"], ["vi", "T-101"], ["depth", "F-101"], ["sterile", "F-102"]]) {
  await page.evaluate((symbol) => {
    const api = window.__pcsPfd.api;
    const els = api.getSceneElements();
    const body = els.find((e) => e.customData?.pcs?.symbol === symbol);
    const g = body.groupIds[0];
    const members = els.filter((e) => e.groupIds?.includes(g));
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries(members.map((m) => [m.id, true])), selectedGroupIds: { [g]: true } } });
  }, symbol);
  await wait(400);
  await page.getByLabel("Equipment tag").fill(tag);
  await page.getByLabel("Equipment tag").press("Enter");
  await wait(600);
}
// Valves drawn on the lines they switch (the line runs through the valve), labelled with their tag, then tagged.
// A valve already on the drawing (its label starts with the tag) is not drawn again.
const VALVES = [
  ["XV-101", "ST-PROA-001", 0.2], ["XV-102", "ST-PROA-002", 0.15], ["XV-103", "ST-PROA-003", 0.15], ["XV-104", "ST-PROA-004", 0.15],
  ["XV-105", "ST-PROA-005", 0.15], ["XV-110", "ST-PROA-006", 0.8], ["XV-111", "ST-PROA-007", 0.2], ["XV-120", "ST-PROA-010", 0.18],
  ["XV-121", "ST-PROA-011", 0.25],
];
for (const [tag, streamId, t] of VALVES) {
  const there = await page.evaluate((tag) => window.__pcsPfd.api.getSceneElements().some((e) => e.type === "text" && (e.originalText ?? e.text).split("\n")[0] === tag), tag);
  if (there) continue;
  await page.evaluate(() => { const api = window.__pcsPfd.api; api.scrollToContent(api.getSceneElements().find((e) => e.type === "frame"), { fitToViewport: true, viewportZoomFactor: 0.8, animate: false }); });
  await page.getByRole("tab", { name: "Symbols" }).click();
  await page.getByRole("button", { name: "Valve", exact: true }).click();
  await wait(350);
  await page.evaluate(({ tag, streamId, t }) => {
    const api = window.__pcsPfd.api;
    const all = api.getSceneElementsIncludingDeleted();
    const g = Object.keys(api.getAppState().selectedGroupIds)[0];
    const arrow = all.find((e) => !e.isDeleted && e.type === "arrow" && e.customData?.pcs?.streamId === streamId && !e.customData.pcs.segment);
    // The point a fraction t along the arrow.
    const pts = arrow.points.map(([x, y]) => [arrow.x + x, arrow.y + y]);
    const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    let left = seg.reduce((a, b) => a + b, 0) * t, i = 0;
    while (i < seg.length - 1 && left > seg[i]) { left -= seg[i]; i++; }
    const f = seg[i] ? left / seg[i] : 0;
    const at = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
    const body = all.find((e) => e.groupIds?.includes(g) && e.customData?.pcs?.symbol);
    const dx = at[0] - (body.x + body.width / 2), dy = at[1] - (body.y + body.height / 2);
    const label = all.filter((e) => e.groupIds?.includes(g) && e.type === "text").sort((a, b) => b.y - a.y)[0];
    api.updateScene({ elements: all.map((e) => {
      if (!e.groupIds?.includes(g)) return e;
      const moved = { ...e, x: e.x + dx, y: e.y + dy, frameId: arrow.frameId ?? e.frameId, version: e.version + 1 };
      if (e.id !== label.id) return moved;
      const [m] = window.__pcsPfd.convert([{ type: "text", x: 0, y: 0, text: tag, fontSize: label.fontSize, fontFamily: label.fontFamily }], { regenerateIds: true });
      return { ...moved, text: tag, originalText: tag, width: m.width, height: m.height, x: at[0] - m.width / 2 };
    }) });
  }, { tag, streamId, t });
  await wait(300);
  await page.getByLabel("Equipment tag").fill(tag);
  await page.getByLabel("Equipment tag").press("Enter");
  await wait(500);
}
if (shot) {
  await page.evaluate(() => window.__pcsPfd.api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} } }));
  await wait(300);
  await page.screenshot({ path: `${shot}-pfd-tags.png` });
}

// ---- the steps, from the Excel action list -------------------------------------------------------------------------------------
await page.getByRole("tab", { name: "Operations", exact: true }).click();
await wait(600);
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Import from Excel…" }).click()]);
  await chooser.setFiles(resolve("examples/operations-downstream.xlsx"));
  await wait(1200);
}
console.log((await page.locator(".dialog").innerText()).replace(/\n/g, " | "));
await page.locator(".dialog").getByRole("button", { name: "Apply" }).click();
await wait(800);
console.log("toast:", await page.locator(".toast").last().innerText().catch(() => ""));
console.log("link check:", (await page.locator(".link-chip").innerText()).trim());
if (shot) {
  await page.getByRole("tab", { name: "Steps & actions" }).click();
  await wait(400);
  await page.screenshot({ path: `${shot}-ops-steps.png` });
  await page.getByRole("tab", { name: "State table" }).click();
  await wait(400);
  await page.screenshot({ path: `${shot}-ops-table.png` });
}

const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save to file" }).click()]);
// The example starts with an empty change log (the lines above are this script's, not the user's).
const saved = JSON.parse(readFileSync(await download.path(), "utf8"));
saved.changeLog = [];
writeFileSync("examples/example-downstream.pcs.json", JSON.stringify(saved));
console.log("wrote examples/example-downstream.pcs.json", errors.length ? `page errors: ${errors.join(" | ")}` : "");
await browser.close();
