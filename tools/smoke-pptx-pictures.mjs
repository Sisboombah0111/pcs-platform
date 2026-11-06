// Browser test of N5.1.1: the PowerPoint export of a drawing with an SVG picture (the stream table on the small
// example's process map). Before, PptxGenJS loaded the SVG from a broken address (404) and the whole export failed
// with "Unable to load image". Now the deck downloads, holds the table as SVG with a real PNG copy, and the toast
// reports no left-out picture. Both modes (editable shapes, pictures).
// Usage: LANG=C.UTF-8 node tools/smoke-pptx-pictures.mjs <base-url> [output-prefix for the decks]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const JSZip = require("jszip");

const [base, out] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true })).newPage();
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
const errors = [], notFound = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("response", (r) => { if (r.status() === 404) notFound.push(r.url().slice(0, 80)); });
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };

await page.goto(base);
await page.waitForSelector(".excalidraw");
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(resolve("examples/example-process.pcs.json"));
  await page.waitForTimeout(2500);
}

async function exportDeck(mode) {
  await page.getByRole("button", { name: /Export to PowerPoint/ }).click();
  await page.waitForTimeout(400);
  if (mode === "pictures") await page.locator("input[name='pptx-mode']").nth(1).check();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator(".dialog .btn.primary").click()]);
  const path = await dl.path();
  if (out) copyFileSync(path, `${out}-${mode}.pptx`);
  await page.waitForTimeout(300);
  const toast = (await page.locator(".toast").allInnerTexts()).join(" | ");
  return { zip: await JSZip.loadAsync(readFileSync(path)), toast, name: dl.suggestedFilename() };
}

// ---- editable shapes: the stream table stays a picture (SVG + its PNG copy) -----------------------------------------------
{
  const { zip, toast } = await exportDeck("shapes");
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  const media = Object.keys(zip.files).filter((f) => f.startsWith("ppt/media/"));
  const svg = media.filter((f) => f.endsWith(".svg"));
  const png = media.filter((f) => f.endsWith(".png"));
  check("editable shapes: the deck downloads (6 slides: 3 drawings + 3 stream tables)", slides.length === 6, `${slides.length} slides`);
  check("the stream table is in the deck as SVG", svg.length === 1 && /ST-10L-/.test(await zip.file(svg[0]).async("string")), svg.join(", "));
  const pngBytes = png.length ? (await zip.file(png[0]).async("uint8array")).length : 0;
  check("…with a real PNG copy for PowerPoint versions without SVG", png.length === 1 && pngBytes > 2000, `${png.length} png, ${pngBytes} bytes`);
  check("the toast says it exported, nothing left out", /Exported 6 slide/.test(toast) && !/left out|Could not export/.test(toast), toast);
}

// ---- pictures mode ------------------------------------------------------------------------------------------------------
{
  const { zip, toast } = await exportDeck("pictures");
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  const media = Object.keys(zip.files).filter((f) => f.startsWith("ppt/media/"));
  check("pictures mode: the deck downloads with a picture per drawing", slides.length === 6 && media.length >= 3, `${slides.length} slides, ${media.length} media`);
  check("pictures mode: nothing left out", !/left out|Could not export/.test(toast), toast);
}

check("no failed image loads (404) and no page errors", notFound.length === 0 && errors.length === 0, [...notFound, ...errors].slice(0, 3).join(" | "));
await browser.close();
