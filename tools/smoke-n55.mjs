// Browser test of N5.5 (the example only when wanted, as a view): Start here leads with Open a project file and
// Add a unit operation, no example description; New starts without sample materials; the example opens as a view
// (yellow bar, "Example · not saved") from Start here or from the New dialog, your own project stays in the
// autosave (a reload brings it back), Close example brings it back as it was (with its undo), an edited example
// asks before closing, and Keep as my project makes the example the autosaved project.
// Usage: LANG=C.UTF-8 node tools/smoke-n55.mjs <base-url> [screenshot-prefix]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`); }

const [base, shot] = process.argv.slice(2);
const browser = await playwright.chromium.launch();
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) process.exitCode = 1; };
const errors = [];
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem("pcs.guide.open", "0"); } catch { /* storage off */ } });
await page.goto(base);
await page.waitForSelector(".excalidraw");
const wait = (ms) => page.waitForTimeout(ms);
const card = page.getByRole("region", { name: "Start here" });
const bar = page.locator(".example-bar");
const name = () => page.getByLabel("Project name").inputValue();
const uoTabs = () => page.locator(".sheet-tab:not(.map):not(.add)").count();
const tab = async (re) => { await page.getByRole("tab", { name: re }).first().click(); await wait(500); };

// ---- Start here: no example up front -------------------------------------------------------------------------------
const actions = await card.locator(".start-actions button").allInnerTexts();
check("Start here: Open a project file first, the example last and only as a view", actions[0] === "Open a project file…" && actions.at(-1) === "Open the example (view only)" && actions.length === 3, JSON.stringify(actions));
check("no example description on the card, a line on what the view is", !/Protein A to frozen storage/.test(await card.innerText()) && /opens as a view: it is not saved/.test(await card.innerText()));
if (shot) await page.screenshot({ path: `${shot}-start.png` });

// ---- New: no sample materials unless ticked --------------------------------------------------------------------------
await page.getByRole("button", { name: "New", exact: true }).click();
check("New project: sample materials off by default, the example offered as a view", !(await page.getByRole("checkbox", { name: /sample materials/ }).isChecked()) && await page.locator(".dialog").getByRole("button", { name: "Open the example (view only)" }).isVisible());
await page.locator(".dialog input.search").fill("My process");
await page.getByRole("checkbox", { name: /sample materials/ }).check();
await page.getByRole("button", { name: "Create", exact: true }).click();
const discard = page.getByRole("button", { name: "Start new without saving" });
if (await discard.isVisible({ timeout: 1500 }).catch(() => false)) await discard.click();
await wait(800);
await tab(/^Materials/);
check("my project: 33 sample materials (ticked)", (await page.locator("table.grid tbody tr[data-code]").count()) === 33 && (await name()) === "My process");
// A change of my own, to undo later.
await page.locator("tr[data-code='MAT-0009'] input[aria-label='Name']").fill("Tris (mine)");
await page.locator("tr[data-code='MAT-0009'] input[aria-label='Name']").press("Tab");
await wait(900);

// ---- the example as a view ---------------------------------------------------------------------------------------------
await page.getByRole("button", { name: "New", exact: true }).click();
await page.locator(".dialog").getByRole("button", { name: "Open the example (view only)" }).click();
await wait(2000);
check("the example opens from New as a view: seven unit operations, the yellow bar, no question asked", (await uoTabs()) === 7 && await bar.isVisible() && /Example: Downstream mAb process/.test(await bar.innerText()) && /your project \(My process\) is kept/.test(await bar.innerText()));
check("title bar and status bar say it is not saved", /Example · not saved/.test(await page.locator(".titlebar .status").innerText()) && /Example: not saved/.test(await page.locator(".sb-where").innerText()));
if (shot) await page.screenshot({ path: `${shot}-view.png` });
await page.reload();
await page.waitForSelector(".excalidraw");
await wait(800);
check("a reload leaves the example: my project is back (the autosave kept it, with my change)", (await name()) === "My process" && !(await bar.isVisible()) && (await uoTabs()) === 0);
await tab(/^Materials/);
check("my change is there", (await page.locator("tr[data-code='MAT-0009'] input[aria-label='Name']").inputValue()) === "Tris (mine)");
await page.locator("tr[data-code='MAT-0009'] input[aria-label='Name']").fill("Tris (mine, 2)");
await page.locator("tr[data-code='MAT-0009'] input[aria-label='Name']").press("Tab");
await wait(500);

// From Start here, then Close example without changes: no question, my project as it was, its undo too.
await tab(/^PFD/);
await card.getByRole("button", { name: "Open the example (view only)" }).click();
await wait(2000);
check("the example opens from Start here", (await uoTabs()) === 7 && await bar.isVisible());
await bar.getByRole("button", { name: "Close example" }).click();
await wait(800);
check("Close example (nothing changed): no question, my project is back", !(await page.locator(".dialog").isVisible().catch(() => false)) && (await name()) === "My process" && !(await bar.isVisible()));
await tab(/^Materials/);
check("my project as it was", (await page.locator("tr[data-code='MAT-0009'] input[aria-label='Name']").inputValue()) === "Tris (mine, 2)");
await page.getByRole("button", { name: "Undo change" }).click();
await wait(300);
check("its undo history came back with it", (await page.locator("tr[data-code='MAT-0009'] input[aria-label='Name']").inputValue()) === "Tris (mine)");

// An edited example asks before it closes.
await tab(/^PFD/);
await card.getByRole("button", { name: "Open the example (view only)" }).click();
await wait(2000);
await tab(/^Materials/);
await page.locator("tr[data-code='CHM-0001'] input[aria-label='Name']").fill("Tris (changed in the example)");
await page.locator("tr[data-code='CHM-0001'] input[aria-label='Name']").press("Tab");
await wait(900);
await bar.getByRole("button", { name: "Close example" }).click();
check("Close example after a change asks first", /Close the example\?/.test(await page.locator(".dialog").innerText()));
await page.locator(".dialog").getByRole("button", { name: "Close example" }).click();
await wait(800);
check("closed: my project, my materials", (await name()) === "My process" && (await page.locator("table.grid tbody tr[data-code]").count()) === 33);

// Keep as my project: the example becomes the autosaved project.
await tab(/^PFD/);
await card.getByRole("button", { name: "Open the example (view only)" }).click();
await wait(2000);
await bar.getByRole("button", { name: "Keep as my project…" }).click();
check("Keep as my project asks (my project has changes not in a file)", await page.locator(".dialog").isVisible());
await page.locator(".dialog").getByRole("button", { name: "Keep the example without saving" }).click();
await wait(1200);
check("kept: no bar, autosaved", !(await bar.isVisible()) && !/Example/.test(await page.locator(".titlebar .status").innerText()));
await page.reload();
await page.waitForSelector(".excalidraw");
await wait(1000);
check("after a reload the example is the project", (await uoTabs()) === 7 && !(await bar.isVisible()) && /Downstream/.test(await name()));

// Before N5.5 an opened example became the autosaved project: one left as it came gives way to an empty project.
{
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const d = page.getByRole("button", { name: "Open without saving" });
    if (await d.isVisible({ timeout: 1500 }).catch(() => false)) await d.click();
  })()]);
  await chooser.setFiles(new URL("../examples/example-downstream.pcs.json", import.meta.url).pathname);
  await wait(2000);
}
check("the example opened as a file is the project, untouched", (await uoTabs()) === 7 && !(await bar.isVisible()));
await wait(1200);
await page.reload();
await page.waitForSelector(".excalidraw");
await wait(1000);
check("opened on purpose, it stays after a reload (the one-time check ran on the first start)", (await uoTabs()) === 7);
// The first start of N5.5 in a browser whose autosave holds the example as it came (opened before N5.5).
await page.evaluate(() => localStorage.removeItem("pcs.n55.exampleCheck"));
await page.reload();
await page.waitForSelector(".excalidraw");
await wait(1000);
check("reload: an untouched example in the autosave gives way to an empty project, with a note", (await uoTabs()) === 0 && await card.isVisible() && /opens only when you ask/.test(await page.locator(".toast").last().innerText().catch(() => "")));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
