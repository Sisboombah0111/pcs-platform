// Browser test of N5.1 (screens that fit, first-time users, version): the top bar keeps Open and Save to file on
// screen from a big monitor down to a laptop at 150 % Windows scaling; the start card of an empty project opens the
// example that comes with the app; a drawing opened from a file shows readable boxes from the start of the
// process, and Fit shows all of it; drawing tabs show the code (the open one also the name); screen explanations
// fold; dialogs put the cursor in the first field and Enter is the main button; the Guide shows the version.
// Usage: LANG=C.UTF-8 node tools/smoke-n51.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const VERSION = require("../package.json").version;

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const errors = [];

async function fresh(width, height, guide = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  if (!guide) await ctx.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
  await page.waitForSelector(".excalidraw");
  await page.waitForTimeout(800);
  return page;
}
/** A button wholly inside the window (not cut off at the right edge, not scrolled away). */
const onScreen = (page, name) => page.getByRole("button", { name, exact: true }).first().evaluate((b) => {
  const r = b.getBoundingClientRect();
  return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
});

// ---- the top bar at four sizes ---------------------------------------------------------------------------------------------------
for (const [w, h, label] of [[1920, 1080, "1920"], [1366, 768, "1366 laptop"], [1280, 720, "1920 at 150 %"], [911, 512, "1366 at 150 %"]]) {
  const page = await fresh(w, h);
  const ok = (await onScreen(page, "Open")) && (await onScreen(page, "Save to file")) && (await onScreen(page, "New"));
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  const rows = await page.evaluate(() => Math.round(document.querySelector(".bar").getBoundingClientRect().height));
  check(`top bar ${label}: New, Open and Save to file on screen, no sideways scrolling`, ok && !sideways, `bar ${rows} px high`);
  if (w === 1366) check("on a 1366 px laptop the top bar is one row", rows <= 60, `${rows} px`);
  await page.context().close();
}

// ---- first visit: the start card, the example that comes with the app --------------------------------------------------------------
{
  const page = await fresh(1366, 768, true);
  const card = page.locator("section[aria-label='Start here']");
  check("an empty project shows the start card", await card.isVisible());
  check("the start card says where autosaved work from the other copy is", /Save to file/.test(await card.innerText()));
  const href = await card.locator("a[download='MB_downstream.xlsx']").getAttribute("href");
  const res = await page.request.get(new URL(href, page.url()).toString());
  check("the example MB workbook downloads from the app", res.ok() && (await res.body()).length > 10000, `${href} → ${res.status()}`);
  check("the Guide shows the version", (await page.locator(".guide-version").innerText()).includes(`N${VERSION.split(".").slice(0, 2).join(".")}`));
  if (shot) await page.screenshot({ path: `${shot}-start.png` });
  await page.getByRole("button", { name: /^Open the example/ }).click();
  const d = page.getByRole("button", { name: "Open without saving" });
  if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  await page.waitForTimeout(2500);
  check("the example opens: seven unit operations, linked", (await page.locator(".sheet-tab:not(.map):not(.add)").count()) === 7 && /^Linked/.test((await page.locator(".link-chip").innerText()).trim()));
  check("the start card is gone once the project has unit operations", !(await card.isVisible().catch(() => false)));

  // ---- the process map: readable from the start of the process; Fit shows all --------------------------------------------------------
  const view = () => page.evaluate(() => { const a = window.__pcsPfd.api; const st = a.getAppState(); return { z: st.zoom.value, sx: st.scrollX, w: st.width }; });
  const firstBox = () => page.evaluate(() => {
    const a = window.__pcsPfd.api; const st = a.getAppState();
    const box = a.getSceneElements().filter((e) => e.customData?.pcs?.kind === "uo" && e.type !== "text").sort((p, q) => p.x - q.x)[0];
    if (!box) return null;
    const left = (box.x + st.scrollX) * st.zoom.value;
    return { left, right: (box.x + box.width + st.scrollX) * st.zoom.value, width: st.width };
  });
  const v1 = await view(), b1 = await firstBox();
  check("opened from a file, the process map is readable (zoom ≥ 50 %) and its first unit operation is in view", v1.z >= 0.5 && b1 && b1.left >= 0 && b1.right <= b1.width, `zoom ${Math.round(v1.z * 100)} %, first box ${b1 ? Math.round(b1.left) + "–" + Math.round(b1.right) : "?"} of ${v1.w} px`);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(900);
  const v2 = await view();
  check("Fit shows the whole process map", v2.z < v1.z, `zoom ${Math.round(v2.z * 100)} %`);

  // ---- drawing tabs: the code; the open tab also the name --------------------------------------------------------------------------
  const tabText = (code) => page.locator(".sheet-tab", { hasText: code }).first().innerText();
  check("drawing tabs show the code only", (await tabText("CEX")).trim() === "CEX");
  await page.locator(".sheet-tab", { hasText: "PROA" }).first().click();
  await page.waitForTimeout(1200);
  check("the open drawing's tab shows the code and the name", /PROA\s+Protein A/.test(await tabText("PROA")), await tabText("PROA"));
  const v3 = await view();
  check("a unit operation drawing opened from the file fits the window", v3.z >= 0.5 && v3.z <= 1, `zoom ${Math.round(v3.z * 100)} %`);
  if (shot) await page.screenshot({ path: `${shot}-proa.png` });

  // ---- screen explanations fold ---------------------------------------------------------------------------------------------------
  await page.getByRole("tab", { name: /^BOM/ }).click();
  await page.waitForTimeout(600);
  const intro = page.locator(".page-head p").first();
  check("BOM: the explanation is one sentence with More…", !/Quantity = source value/.test(await intro.innerText()) && /More…/.test(await intro.innerText()));
  await intro.getByRole("button", { name: "More…" }).click();
  check("More… shows the rest", /Quantity = source value/.test(await intro.innerText()));
  await intro.getByRole("button", { name: "Less" }).click();

  // ---- Materials: the whole table on a 1366 px laptop (Guide closed: it takes the right of the screen) ----------------------------
  await page.locator(".guide-btn").click();
  await page.getByRole("tab", { name: /^Materials/ }).click();
  await page.waitForTimeout(600);
  const wrap = await page.evaluate(() => { const t = document.querySelector(".table-wrap"); return t ? { sw: t.scrollWidth, cw: t.clientWidth } : null; });
  check("Materials: every column fits a 1366 px laptop (no sideways scrolling)", wrap && wrap.sw <= wrap.cw + 1, JSON.stringify(wrap));
  check("Materials: a long name shows in full on hover", (await page.locator("tr[data-code='CHM-0003'] input[aria-label='Name']").getAttribute("title")) === "Acetic acid, glacial");

  // ---- Mass Balance: the saving application by name ------------------------------------------------------------------------------
  await page.getByRole("tab", { name: /^Mass Balance/ }).click();
  await page.waitForTimeout(800);
  const chips = await page.locator(".mb-file-main").innerText();
  check("Mass Balance: 'Saved by LibreOffice', no build string or fingerprint in view", /Saved by LibreOffice/.test(chips) && !/\$Linux|[0-9a-f]{10}/.test(chips), chips.replace(/\n/g, " | "));

  // ---- dialogs: cursor in the first field, Enter = the main button -------------------------------------------------------------------
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.waitForTimeout(300);
  check("New project: the cursor is in the name field", await page.evaluate(() => document.activeElement?.closest(".dialog") !== null && document.activeElement?.tagName === "INPUT" && document.activeElement.type !== "checkbox"));
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Enter test");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const guard = page.getByRole("button", { name: "Start new without saving" });
  if (await guard.isVisible({ timeout: 1000 }).catch(() => false)) await guard.click();
  await page.waitForTimeout(800);
  check("Enter in the field creates the project (once)", (await page.getByLabel("Project name").inputValue()) === "Enter test" && (await page.locator(".dialog").count()) === 0);
  check("the new empty project shows the start card again", await page.locator("section[aria-label='Start here']").isVisible());
  await page.context().close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
