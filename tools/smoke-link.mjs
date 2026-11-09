// Browser test of the link between the PFD, the Mass Balance, the BOM and the material list:
// after applying the example MB, delete a stream on the PFD (its MB values leave the BOM and the link
// check says why; undo brings them back), change a material's unit (left out, then back), replace the
// workbook without applying it (banners on PFD and BOM, shortcut to Mass Balance), and a new stream
// without an MB value (a note that shows the stream on the PFD).
// Usage: LANG=C.UTF-8 node tools/smoke-link.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
// The in-app guide opens on a first visit; these checks run with it closed (tools/smoke-guide.mjs tests it).
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const text = (sel) => page.locator(sel).innerText();
const ex = (f) => resolve("examples", f);
const chip = () => text(".link-chip");
const tab = async (name) => { await page.getByRole("tab", { name, exact: true }).click(); await wait(600); };
const chooseFile = async (button, file, confirmLabel) => {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: button }).click()]);
  await chooser.setFiles(file);
  if (confirmLabel) await page.getByRole("button", { name: confirmLabel, exact: true }).click();
  await wait(1200);
};
/** BOM quantities shown for one material in one unit operation: [Sending, Receiving]. */
const bomQty = async (uo, code) => {
  const row = page.locator(`section[aria-label='BOM ${uo}'] tbody tr`, { has: page.locator("td", { hasText: new RegExp(`^${code}$`) }) });
  const td = row.locator("td");
  return [(await td.nth(7).innerText()).trim(), (await td.nth(8).innerText()).trim(), (await row.innerText()).replace(/\n/g, " ")];
};
const openSheet = async (label) => { await page.locator(".sheet-tab", { hasText: label }).first().click(); await page.waitForFunction(() => window.__pcsPfd?.api); await wait(900); };

await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForFunction(() => window.__pcsPfd?.api);
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(ex("example-process.pcs.json"));
  await wait(1500);
}
await tab("Mass Balance");
await chooseFile("Upload Excel workbook…", ex("MB_example.xlsx"));
check("before applying: the link chip asks to apply", /to fix/.test(await chip()), await chip());
await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
await wait(1200);
check("after applying: everything lines up", (await chip()).trim() === "Linked", await chip());
await tab("BOM");
check("BOM: MAT-0002 in 100L from the MB", JSON.stringify((await bomQty("100L", "MAT-0002")).slice(0, 2)) === JSON.stringify(["0.62", "3.1"]));

// ---- delete a stream on the PFD -------------------------------------------------------------------------
await tab("PFD");
await openSheet("100L 100L");
await page.evaluate(() => {
  const api = window.__pcsPfd.api;
  const a = api.getSceneElements().find((e) => e.customData?.pcs?.streamId === "ST-100L-002" && !e.customData.pcs.segment);
  api.updateScene({ appState: { selectedElementIds: { [a.id]: true } } });
});
await page.locator(".excalidraw").first().focus().catch(() => {});
await page.keyboard.press("Delete");
await wait(1500);
check("deleting ST-100L-002 on the PFD: the link chip says 1 to fix", /1 to fix/.test(await chip()), await chip());
await tab("BOM");
let q = await bomQty("100L", "MAT-0002");
check("BOM leaves its MB value out", ["", "–", "—"].includes(q[0]) && ["", "–", "—"].includes(q[1]), q.slice(0, 2).join(" / "));
check("the line explains it", /ST-100L-002 is no longer on the PFD/.test(q[2]), q[2]);
check("a notice at the top says values were left out", /left out because they no longer match the PFD/.test(await text(".page")));
if (shot) await page.screenshot({ path: `${shot}-bom.png` });
await page.locator(".link-chip").click();
await wait(300);
const dlg = await text(".dialog");
check("the link check lists the stream and its values", /MB values for 1 stream\(s\) that are no longer on the PFD/.test(dlg) && /ST-100L-002 \(100L\): flow Sending 5 · Receiving 25 L; MAT-0002 Sending 0.62 · Receiving 3.1 kg/.test(dlg), dlg.replace(/\n/g, " | "));
if (shot) await page.screenshot({ path: `${shot}-dialog.png` });
await page.getByRole("button", { name: "Open PFD" }).click();
await wait(800);
check("'Open PFD' goes to the PFD", await page.locator(".pfd-layer").isVisible() && !(await page.locator(".dialog").count()));
// Undo needs the keyboard in the drawing: click an empty spot of the canvas first.
{
  const box = await page.locator(".pfd-canvas").boundingBox();
  await page.mouse.click(box.x + box.width - 60, box.y + box.height - 120);
}
await page.keyboard.press("Control+z");
await wait(1600);
check("undo on the PFD: everything lines up again", (await chip()).trim() === "Linked", await chip());
await tab("BOM");
check("and the BOM counts MAT-0002 again", JSON.stringify((await bomQty("100L", "MAT-0002")).slice(0, 2)) === JSON.stringify(["0.62", "3.1"]));

// ---- change a material's unit ------------------------------------------------------------------------------
await page.getByRole("tab", { name: /^Materials/ }).click();
await wait(400);
const unit = page.locator("table.grid tbody tr", { has: page.locator("input[value='MAT-0001']") }).getByLabel("Unit");
await unit.fill("g");
await wait(900);
check("a material now counted in g: 1 to fix", /1 to fix/.test(await chip()), await chip());
await tab("BOM");
q = await bomQty("100L", "MAT-0001");
check("its kg values from the MB are left out of the BOM, with the reason", /the MB gives kg, but MAT-0001 is counted in g/.test(q[2]), q[2]);
await tab("Mass Balance");
await page.getByRole("tablist", { name: "Sheets" }).getByRole("tab", { name: /^Material totals/ }).click();
check("Mass Balance shows which material totals are left out", /Left out: unit differs from the material list/.test(await text(".page")));
await page.getByRole("tab", { name: /^Materials/ }).click();
await unit.fill("kg");
await wait(900);
check("back to kg: lines up again", (await chip()).trim() === "Linked", await chip());

// ---- a workbook replaced but not applied ----------------------------------------------------------------------
await tab("Mass Balance");
await chooseFile("Replace…", ex("MB_example_v2.xlsx"), "Replace");
check("a new workbook not applied yet: flagged", /1 to fix/.test(await chip()), await chip());
await tab("BOM");
check("BOM says the MB quantities are the ones applied before", /changed after its values were applied/.test(await text(".page")));
await tab("PFD");
check("PFD shows a banner with Review and apply", await page.locator(".pfd-banner").isVisible());
if (shot) await page.screenshot({ path: `${shot}-pfd-banner.png` });
await page.locator(".pfd-banner").getByRole("button", { name: "Review and apply" }).click();
await wait(600);
check("which opens Mass Balance", /Apply to PFD and BOM/.test(await text(".ribbon")));
await page.getByRole("button", { name: "Apply to PFD and BOM" }).click();
await wait(1200);
check("applied: lines up, the PFD banner is gone", (await chip()).trim() === "Linked" && !(await page.locator(".pfd-banner").count()), await chip());

// ---- a new stream without an MB value: a note that shows it on the PFD ------------------------------------------
await tab("PFD");
await openSheet("100L 100L");
const newId = await page.evaluate(() => {
  const api = window.__pcsPfd.api;
  const f = api.getSceneElements().find((e) => e.type === "frame");
  const [a] = window.__pcsPfd.convert([{ type: "arrow", x: f.x + 40, y: f.y + f.height - 40, width: 120, height: 0, points: [[0, 0], [120, 0]] }], { regenerateIds: true });
  api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), a] });
  return a.id;
});
await wait(1600);
check("a new stream without an MB value: a note, nothing to fix", /Linked · 1 note/.test(await chip()), await chip());
await tab("BOM");
await page.locator(".link-chip").click();
await wait(300);
const item = page.locator(".dialog .link-items button.linkish", { hasText: "ST-100L-003" });
check("the note lists ST-100L-003", await item.isVisible());
await item.click();
await wait(1200);
const sel = await page.evaluate(() => Object.keys(window.__pcsPfd.api.getAppState().selectedElementIds));
check("clicking it shows the arrow on the PFD", sel.includes(newId), sel.join(","));

// ---- the example (18 samples) can take the samples added later: lines and the transfer panel ----------------
await page.getByRole("tab", { name: /^Materials/ }).click();
await wait(400);
await page.getByRole("button", { name: "Add 15 missing sample(s)" }).click();
await wait(600);
const codes = await page.locator("table.grid tbody tr input[aria-label='Code']").evaluateAll((els) => els.map((e) => e.value));
check("'Add 15 missing samples' adds the lines, the transfer panel and the buffer chemicals", codes.length === 33 && ["MAT-0031", "MAT-0038", "MAT-0039"].every((c) => codes.includes(c)), codes.slice(-15).join(","));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
