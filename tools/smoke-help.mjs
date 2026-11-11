// Browser test of N5.6.2 (PFD Help and the drawing editor's dialogs with Windows animations off): with
// "reduce motion" on (Windows › Accessibility › Animation effects off), the Help button, the menu's Help and
// Export image… open a dialog that is actually shown (not an invisible one that blocks the screen), on a
// laptop and at 150 % scaling, and Esc closes it; the same with animations on.
// Usage: LANG=C.UTF-8 node tools/smoke-help.mjs <base-url>
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const errors = [];

/** The open dialog: shown (opaque, on top at its middle) or not. */
const shown = (page, cls) => page.evaluate((c) => {
  const d = document.querySelector(`.${c} .Modal__content`);
  if (!d) return { open: false };
  const r = d.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(60, r.height / 2));
  return { open: true, opacity: Number(getComputedStyle(d).opacity), onTop: !!top && d.contains(top), rect: [r.x, r.y, r.width, r.height].map(Math.round) };
}, cls);

async function session(label, { width, height, reducedMotion }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
  await page.waitForSelector(".excalidraw");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /^Open the example/ }).click();
  await page.waitForTimeout(2500);
  const ok = (s) => s.open && s.opacity > 0.99 && s.onTop;
  const fmt = (s) => JSON.stringify(s);

  // The Help button under the drawing (on a wide enough drawing), else the menu's Help.
  const icon = page.locator(".excalidraw .help-icon");
  if (await icon.count()) {
    await icon.first().click();
    await page.waitForTimeout(400);
    const s = await shown(page, "HelpDialog");
    check(`${label}: the Help button shows the Help dialog`, ok(s), fmt(s));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check(`${label}: Esc closes it and the drawing answers again`, !(await shown(page, "HelpDialog")).open && (await page.locator(".excalidraw .help-icon").isVisible()));
  }
  await page.locator(".excalidraw .main-menu-trigger").first().click();
  await page.waitForTimeout(300);
  await page.locator(".dropdown-menu-item", { hasText: "Help" }).first().click();
  await page.waitForTimeout(400);
  let s = await shown(page, "HelpDialog");
  check(`${label}: menu › Help shows the Help dialog`, ok(s), fmt(s));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator(".excalidraw .main-menu-trigger").first().click();
  await page.waitForTimeout(300);
  await page.locator(".dropdown-menu-item", { hasText: "Export image" }).first().click();
  await page.waitForTimeout(600);
  s = await shown(page, "Modal");
  check(`${label}: menu › Export image… shows its dialog`, ok(s), fmt(s));
  await page.keyboard.press("Escape");
  await ctx.close();
}

await session("animations off, 1366 laptop", { width: 1366, height: 768, reducedMotion: "reduce" });
await session("animations off, 1366 at 150 %", { width: 911, height: 512, reducedMotion: "reduce" });
await session("animations on, 1366 laptop", { width: 1366, height: 768, reducedMotion: "no-preference" });
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
