// Do the built-in PFD symbols look the same in PowerPoint as in the app?
// The symbols are laid out 12 per sheet (4 × 3, at the size they have on a unit operation drawing) inside a light
// frame. Each sheet is pictured twice: by the editor itself (Excalidraw's export) and by the real PowerPoint
// exporter (one slide per sheet), rendered by LibreOffice. tools/compare-symbols-sheet.py cuts both into cells,
// scores how well each symbol's two shapes overlap, and draws them side by side, lowest scores first.
// Needs a built app served (the ?debug hooks), LibreOffice (soffice) and pdftoppm (poppler), Python 3 with Pillow.
// Usage: LANG=C.UTF-8 node tools/compare-symbols-pptx.mjs <base-url> <out-dir>
import { createRequire } from "node:module";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, outArg] = process.argv.slice(2);
if (!base || !outArg) { console.error("Usage: node tools/compare-symbols-pptx.mjs <base-url> <out-dir>"); process.exit(2); }
const out = resolve(outArg);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "app"), { recursive: true });
mkdirSync(join(out, "pptx"), { recursive: true });

const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
await page.goto(base + (base.includes("?") ? "&" : "?") + "debug");
await page.waitForSelector(".excalidraw");
await page.waitForFunction(() => window.__pcsPfd?.symbolSheets);

const meta = await page.evaluate(() => window.__pcsPfd.symbolSheets().map((s) => ({ ids: s.ids, names: s.names })));
for (let i = 0; i < meta.length; i++) {
  const dataUrl = await page.evaluate((k) => window.__pcsPfd.png(window.__pcsPfd.symbolSheets()[k].elements, 2.5), i);
  writeFileSync(join(out, "app", `sheet-${String(i + 1).padStart(2, "0")}.png`), Buffer.from(dataUrl.split(",").pop(), "base64"));
}
const deck = await page.evaluate(() => window.__pcsPfd.deck(window.__pcsPfd.symbolSheets()));
await browser.close();
writeFileSync(join(out, "symbols.pptx"), Buffer.from(deck, "base64"));
writeFileSync(join(out, "sheets.json"), JSON.stringify({ perRow: 4, rows: 3, sheets: meta }, null, 1));

execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", out, join(out, "symbols.pptx")], { stdio: "ignore", timeout: 300000 });
execFileSync("pdftoppm", ["-r", "160", "-png", join(out, "symbols.pdf"), join(out, "pptx", "slide")], { timeout: 300000 });
const pages = readdirSync(join(out, "pptx")).filter((f) => f.endsWith(".png"));
console.log(`${meta.reduce((n, s) => n + s.ids.length, 0)} symbols on ${meta.length} sheets; ${pages.length} slides rendered`);
execFileSync("python3", ["-I", resolve("tools/compare-symbols-sheet.py"), out], { stdio: "inherit" });
