// Browser test of N5.5.1 (symbols keep their shape when made bigger): every line of every built-in symbol is
// measured from its points when it is inserted (Excalidraw sized a line skeleton 100 × 0, so a resize scaled the
// points to that box and the lines fell flat), and a symbol dragged bigger by its corner straight after it is
// inserted scales every line with its body.
// Usage: LANG=C.UTF-8 node tools/smoke-resize.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForFunction(() => window.__pcsPfd?.api);
await wait(800);
await page.getByRole("button", { name: "Hide the start card" }).click().catch(() => {});

// ---- every built-in symbol, as inserted ------------------------------------------------------------------------
const bad = await page.evaluate(() => {
  const out = [];
  for (const sheet of window.__pcsPfd.symbolSheets()) for (const e of sheet.elements) {
    if (e.type !== "line") continue;
    const xs = e.points.map((p) => p[0]), ys = e.points.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (e.points[0][0] !== 0 || e.points[0][1] !== 0 || Math.abs(e.width - w) > 0.01 || Math.abs(e.height - h) > 0.01) out.push(`${e.width}×${e.height} vs ${w}×${h}`);
  }
  return { bad: out, lines: window.__pcsPfd.symbolSheets().flatMap((s) => s.elements).filter((e) => e.type === "line").length };
});
check("every line of every built-in symbol is measured from its points, first point at 0,0", bad.lines > 50 && bad.bad.length === 0, `${bad.lines} lines; ${bad.bad.slice(0, 3).join(", ")}`);

// ---- drag a symbol bigger right after inserting it ----------------------------------------------------------------
const groupOf = () => page.evaluate(() => {
  const a = window.__pcsPfd.api, st = a.getAppState();
  const sel = a.getSceneElements().filter((e) => st.selectedElementIds[e.id]);
  const ext = (e) => e.points ? [e.x + Math.min(...e.points.map((p) => p[0])), e.y + Math.min(...e.points.map((p) => p[1])), e.x + Math.max(...e.points.map((p) => p[0])), e.y + Math.max(...e.points.map((p) => p[1]))] : [e.x, e.y, e.x + e.width, e.y + e.height];
  const x2 = Math.max(...sel.map((e) => ext(e)[2])), y2 = Math.max(...sel.map((e) => ext(e)[3]));
  const z = st.zoom.value;
  return {
    corner: { x: (x2 + st.scrollX) * z + st.offsetLeft, y: (y2 + st.scrollY) * z + st.offsetTop },
    body: sel.filter((e) => e.customData?.pcs?.symbol).map((e) => ({ w: e.width, h: e.height }))[0],
    lines: sel.filter((e) => e.type === "line").map((e) => ({ id: e.id, w: e.width, h: e.height, pts: e.points.map((p) => [p[0], p[1]]) })),
  };
});
const close = (a, b) => Math.abs(a - b) <= Math.max(0.6, Math.abs(b) * 0.01);
for (const name of ["Filter", "Prefilter", "Depth filter", "Sterile filter (0.2 µm)"]) {
  await page.locator("button.symbol", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }).first().click();
  await wait(400);
  const before = await groupOf();
  const { x, y } = before.corner;
  await page.mouse.move(x + 9, y + 9);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 80, { steps: 6 });
  await page.mouse.move(x + 110, y + 150, { steps: 6 });
  await page.mouse.up();
  await wait(500);
  const after = await groupOf();
  const sx = after.body.w / before.body.w, sy = after.body.h / before.body.h;
  const wrong = before.lines.filter((l) => {
    const n = after.lines.find((m) => m.id === l.id);
    return !n || !close(n.w, l.w * sx) || !close(n.h, l.h * sy) || n.pts.some((p, i) => !close(p[0], l.pts[i][0] * sx) || !close(p[1], l.pts[i][1] * sy));
  });
  check(`${name}: dragged bigger (×${sx.toFixed(2)}), every line scales with the body`, sx > 1.5 && wrong.length === 0 && before.lines.length > 0,
    wrong.length ? JSON.stringify(after.lines.find((m) => m.id === wrong[0].id)) : `${before.lines.length} line(s)`);
  await page.keyboard.press("Escape");
}
if (shot) await page.screenshot({ path: `${shot}-resized.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
