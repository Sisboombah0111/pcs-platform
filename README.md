# PCS Platform

A web app for bioprocess design that links the **PFD** (process flow diagram), the **Mass Balance** (the engineer's own MB workbook) and the **BOM** through Stream IDs. It runs entirely in the browser, with no backend, and is published with GitHub Pages.

## Use it

Open **https://sisboombah0111.github.io/pcs-platform/** in Chrome or Edge. There is nothing to install. Work autosaves in that browser; **Save to file** and **Open** move a project (`.pcs.json`) between people and computers.

A new, empty project shows **Start here**: **Open a project file…**, **Add a unit operation**, and **Open the example (view only)** — the downstream mAb process with its Mass Balance applied, opened as a view that is not saved: a yellow bar says so, **Close example** (or a reload) brings your own project back as it was, and **Keep as my project…** keeps the example instead. **New** offers the same example, and starts without sample materials unless you tick them. *More examples and example workbooks* has the small example and the example MB workbook, material list and operation steps to download. The same files are in [`examples/`](examples/).

**PC version** (for computers where the site does not open, e.g. a company network): download the zip from the [latest release](https://github.com/Sisboombah0111/pcs-platform/releases/latest), extract it to a new folder (e.g. `C:\PCS\v5.3.0`), open `pcs-app` and double-click `start-windows.cmd`. It needs [Node.js](https://nodejs.org/) and nothing else. The version is at the bottom of the **Guide** panel.

Each address keeps its own autosave: work done at another address (for example the PC version at http://localhost:5173) is not shown on the site. Move it with **Save to file** there and **Open** on the site.

Project data never goes to GitHub: it stays in each user's browser and in the files they save.

## Status

| Step | Scope | State |
| --- | --- | --- |
| N0 | GridCraft proof of concept, `PCS_LINK` sheet rules, Stream ID rules | Done |
| N1 | App shell, project file + autosave, materials, PFD board (Excalidraw), deployment | Done |
| N2 | PFD symbol library, UO frames, automatic Stream IDs and labels, material links, tables | Done |
| N3 | Mass Balance: GridCraft inside the app, `PCS_LINK` import and checks V1–V8 | Done |
| N4 | BOM: quantity source per line (MB, PFD, manual), Sending/Receiving totals, Excel export | Done |
| N4.1 | PFD split per unit operation: a process map plus one drawing per unit operation, with connectors for transfers (project file v2; v1 files convert on opening) | Done |
| N4.2 | Downstream symbol library (50 symbols in 8 categories, search), your own symbols (upload pictures, Excalidraw libraries or symbol sets; save a selection), GridCraft first on the Mass Balance screen | Done |
| N4.3 | Link check: applied MB values are checked against the current PFD and material list all the time; values that no longer match leave the BOM with the reason; link status in the top bar | Done |
| N4.4 | 85 symbols (connections & transfer: transfer panel, U-bend, aseptic connector, tri-clamp, tube weld/seal, hose; BPE valves; utilities & CIP; more instruments), Tank → Hold vessel; line and transfer panel materials; material links on arrows (lines); clearer Windows launcher | Done |
| N4.5 | Prepared materials (buffers, media, stock solutions) with a recipe: the BOM turns their quantities into chemicals; backup (alternate) materials listed under the BOM lines and summed apart; Recipes and Backups sheets in the material file | Done |
| N4.6 | Downstream example: mAb from 15,000 L (or 2,000 L) harvest through Protein A with VI and depth filtration, CEX, mixed-mode, virus filtration, UF/DF, bulk fill and −70 °C storage, with its material file (recipes, backups) and MB workbook | Done |
| N4.7 | Side panel of the PFD and table columns (Mass Balance, BOM, Materials) resized by dragging; PFD export to PowerPoint: the process map and each unit operation on their own 16:9 slides, as editable shapes or pictures, with a stream table after each drawing | Done |
| N4.8 | Larger text (body 16 px, tables 15 px) and darker grey text; the PFD inspector no longer spills out of the side panel | Done |
| N4.9 | Batches in recipes (rounded up: bags or filters per preparation), bag and tank versions of a buffer in the downstream example; in-app **Guide** (seven linking steps with live status, help per screen, rules; English / 한국어); a formula that calculates to 0 is read as 0 | Done |
| N4.10 | A BOM that keeps changing: search, category and to-check / manual / changed filters, folding sections; **revisions** (Rev A, B …) saved in the project, lines changed since a revision marked, any two compared and exported; **Where used** for every material (BOM, recipes, MB rows, PFD links, backups) with jumps to each place; dated BOM file names | Done |
| N4.11 | Materials that change: **status** (In use / Under review / Obsolete; an obsolete material still used is flagged on the BOM and in the link check); **Replace…** a material everywhere (BOM, recipes, PFD links, backups, the MB workbook's PCS_LINK rows); a **code change** carried into the MB workbook (only those cells change); revisions read a code change as a change | Done |
| N4.12 | **Operations** (the team lead's "actions" direction, first part): **equipment tags** on PFD shapes (XV-101, P-101 …, the tag is the first line of the label); per unit operation its **steps** (minutes, the Stream IDs that flow, with the applied MB value) and the **actions** in them (open/close a valve, start/stop a pump or agitator, or a value); a **state table** (equipment × steps, a click switches a cell); step templates; Excel export and import (Equipment, Steps, Actions, a States sheet per unit operation; Korean words work); project file v3 when it has operations | Done |
| N4.13 | **Undo / redo** (↶ ↷ in the top bar, Ctrl+Z / Ctrl+Y outside the drawing) for Materials, BOM, Operations and Mass Balance — typing counts as one step, an undo never overwrites a later change; a **change log** (who, when, what) saved with the project, searchable and exported to Excel; "not saved to a file" shown as a dot on **Save to file** | Done |
| N4.14 | **Step view on the PFD**: pick a step and the drawing shows what happens in it (tagged valves green when open, grey when closed, ▶ on the ones switched at the start of the step, the step's streams in blue, its actions in order in a card); ◀ ▶ through the steps; **Show on PFD** from Operations; actions in a step **reordered** (‹ › on each action); the downstream example has its PROA valves drawn and tagged | Done |
| N4.15 | **Purchasing** on Materials (supplier, part no., pack size; shown with the *Purchasing* box) and **whole packs to order** on the BOM totals (⌈total ÷ pack size⌉, in the Excel too); **select materials and edit them together** (category, spec, overage, supplier, pack size, note, status) or delete them, with undo; **duplicate a unit operation** (drawing with new Stream IDs, steps with their streams, BOM lines, equipment with new tags such as XV-101 → XV-201, or the same equipment) | Done |
| N4.16 | **Scenarios** beyond Sending / Receiving (Mass Balance › Scenarios: add, rename, order, PCS_LINK column, remove — the workbook check says when a column is missing); every screen, label and export shows them all; the **material view** (Where used) shows the material's facts and its quantities per unit operation and scenario, with the total, packs to order and batches | Done |
| N5 | GitHub repository and the GitHub Pages site (deployed from `main` by Actions, GridCraft included), example projects, user guide | Done |
| N5.3 | **Materials, BOM and Operations as Excel workbooks** too: sheets at the bottom (Materials: Material list · Recipes · Backups; BOM: All · one per unit operation · Totals; Operations: one per unit operation · Equipment), column letters and row numbers on every table (drawn by CSS from `data-col` / `data-rn`, so the tables keep their cells), a formula bar showing the whole contents of the active cell and editing a text cell from there, clicking a row number selects the row, the find boxes and filters in the ribbon. Shared in `src/ui/Workbook.tsx`. Linkage unchanged (`tools/linkage-snapshot.mjs` identical on both examples) | Done |
| N5.4 | **One-line rows, as in Excel.** BOM: each line one row high — the material cell runs its extra text on in the same line (cut off at the edge, all of it in the tooltip and the formula bar via `data-full`), a corner mark when there is something to read (red issue, blue change since the revision, grey note), a Batches column (`10 / 0 × 200 L`) when the project has batch recipes, “+ Backup” over the cell's end on hover, Replace… first in the cell. Operations: a step's streams and actions read as one line and open a list below the cell with the same editors (`src/ui/CellDropdown.tsx`; click, Alt+↓ or F2; Esc or a click elsewhere closes it; it opens upwards near the bottom). Linkage unchanged (`tools/linkage-snapshot.mjs` identical on both examples) | Done |
| N5.5 | **The example only when wanted.** Start here leads with Open a project file and Add a unit operation; the example opens as a view (`ExampleView` in `src/App.tsx`): not autosaved, your project kept with its undo history, **Close example** / a reload brings it back, an edited example asks before closing, **Keep as my project…** makes it the autosaved project. New starts without sample materials. An example autosaved as it came (before N5.5) gives way to an empty project on start (`isUntouchedExample`, ids checked by `test/examples.test.ts`). Linkage unchanged | Done |
| N5.5.1 | **Symbols keep their shape when made bigger.** Excalidraw builds a line skeleton 100 wide and 0 high whatever its points (arrows are sized from theirs), and a resize scales the points to that box: the lines inside a symbol (a filter's diagonal, a prefilter's zigzag, dashed lines) fell flat and ran off to the right when the symbol was dragged bigger before a reload. `symbolElements` now measures each line from its points (`fitLine` in `src/pfd/symbols.ts`), and placement measures lines and arrows from their points (`extentOf`). Symbols already flattened stay so: delete and insert them again | Done |
| N5.2 | Office look, so it feels like the tools people already use: a title bar (quick Save, Undo, Redo; project name; autosave; link status; Guide), the screens as ribbon tabs and a **ribbon** with each screen's buttons (full, or one line for a laptop), Excel green on the table screens and PowerPoint orange on the PFD, tables drawn like a sheet (gridlines, header row), cells selected as in Excel with **Average · Count · Sum** in a **status bar**, **Ctrl+C** copies cells for Excel, and a zoom slider; keys as in Excel (arrows, Tab, Enter, Shift+arrows, F2 or typing edits, ↑ ↓ between fields, Ctrl+F finds). **Mass Balance as a workbook**: the file and its state in one bar, sheets at the bottom (Streams, Material totals, Check, Changes, History) with column letters and row numbers, changed values in yellow, a formula bar showing each value's PCS_LINK cell and formula, Apply and the label settings in the ribbon. PFD ribbon: Insert (unit operation, stream table, table), View, Export. Icons: Fluent UI System Icons (MIT). Linkage unchanged (`tools/linkage-snapshot.mjs` identical on both examples) | Done |
| N5.1.2 | PowerPoint shapes as in the app: rounded boxes keep their corners (a single-use bag came out as an oval), the editor's dash lengths with round ends, dashes starting at corners as on screen, hatching drawn as lines, round line ends and corners, text at the same height. Checked symbol by symbol with `tools/compare-symbols-pptx.mjs` | Done |
| N5.1.1 | PowerPoint export of drawings with an SVG picture (a stream table on the drawing, an uploaded SVG symbol): it failed with "Unable to load image"; an unreadable picture now leaves only itself out | Done |
| N5.1 | Screens that fit a laptop (top bar, drawings fitted on open, **Fit**, shorter explanations, columns), **Start here** with the examples in the app, the version in the Guide, the PC version as a release zip | Done |

## How to review

Pick one of three ways, from quickest to closest to real use.

### 1. Preview page (1 minute, nothing to install)

Open the "PCS Platform" preview link shared in the chat. It is a single-file build of the same app. Downloads are blocked there, so **Save to file** and **Export to Excel** may do nothing, and GridCraft is not included (the Mass Balance screen works with uploaded files). Everything else works and autosaves in that browser.

### 2. Run it on your PC (all features)

1. Install the LTS version of [Node.js](https://nodejs.org/) (18 or newer runs the app; 22 or 24 LTS is best).
2. **Windows**: download the zip from the [latest release](https://github.com/Sisboombah0111/pcs-platform/releases/latest) and extract it to a short folder that OneDrive does not sync (e.g. `C:\PCS\v5.3.0`), open the `pcs-app` folder and double-click `start-windows.cmd`. The zip comes with the app already built (the `dist` folder, GridCraft included), so nothing is installed: a small Node.js server (`tools/serve.mjs`, no packages) serves it and the browser opens at http://localhost:5173. Keep the black window open while you use the app; close it to stop. Started twice from the same folder, it only opens the browser again.
3. **Any system, by hand**: in the folder, `node tools/serve.mjs` (or `npm run serve`) and open http://localhost:5173. Stop with Ctrl+C.
4. **Without the `dist` folder** (a copy from GitHub): `start-windows.cmd` builds it once (`npm install`, GridCraft from its release, `npm run build`; needs Node.js 20.19+ and access to the npm registry). By hand: `npm install`, `npm run gridcraft`, `npm run build`, `npm run serve`.

Why not the development server (`npm run dev`)? It re-bundles packages into `node_modules\.vite` while it runs, and on Windows antivirus or folder sync can lock that folder (`EBUSY: resource busy or locked, rename … node_modules\.vite\deps_temp…`). Use it only for development.

If GridCraft is missing (a copy built without it), the app still works: the Mass Balance screen then uses Download → Excel → Replace. To add GridCraft later, download `gridcraft-web-0.13.0.zip` from the [GridCraft releases](https://github.com/storytold/gridcraft/releases/tag/v0.13.0), run `node tools/fetch-gridcraft.mjs <path to the zip>` and `npm run build`.

On Windows, if PowerShell says "running scripts is disabled", use Command Prompt instead (type `cmd` in the File Explorer address bar of the folder and press Enter).

### 3. GitHub Pages (how the team will use it)

This repository is published at https://sisboombah0111.github.io/pcs-platform/: every push to `main` tests, builds and deploys it. To publish a copy of your own:

1. Create a repository, e.g. `pcs-platform`.
2. Push the folder with git or GitHub Desktop. Uploading through the web page can skip the hidden `.github` folder, and then nothing deploys.
3. In the repository: **Settings › Pages › Source: GitHub Actions**.
4. Open the **Actions** tab and wait for "Test and deploy". The site appears at `https://<owner>.github.io/<repo>/`.

GitHub Pages works for public repositories on GitHub Free; private repositories need GitHub Pro, Team or Enterprise Cloud. The site itself is public on the internet even when the repository is private. Project data is not on the site: it stays in each user's browser and in the `.pcs.json` files they save.

### What to check in N4.16 (scenarios, material view)

1. Open the downstream example, **Mass Balance › Scenarios (2)…**: **+ Scenario**, name it e.g. `Clinical 500 L` (the PCS_LINK column follows the name until you change it); rename *Sending* to `Sending 2,000 L` if you like (its values stay, the PFD label keeps “S”). **Save**.
2. The workbook check now warns *No 'Clinical 500 L' column …*; the BOM has a third quantity column (empty for now). Add a `Clinical 500 L` column to PCS_LINK in the workbook (in GridCraft or Excel), then **Apply**: the BOM, the totals, Excel exports and the PFD labels (*S … · R … · C …*) show its values.
3. In **Scenarios** you can also change the order (↑) or remove one (its values stay in the project but are not shown; ↶ brings it back).
4. **BOM**: click a material code (e.g. CHM-0002 in a recipe row) — the window now starts with the material's facts (unit, category, spec, overage, supplier, part no., pack) and a **Quantities** table: each unit operation, how it gets there (its own line, or in which prepared material), per scenario, then the total, packs to order and batches.

### What to check in N4.15 (purchasing, editing many materials, duplicating a unit operation)

1. **Materials**: tick **Purchasing** (above the table): *Supplier*, *Part no.* and *Pack size* columns appear (remembered in this browser). Give `CHM-0002` (sodium chloride) pack size 25.
2. **BOM › Totals per material**: *To order* says how many 25 kg packs for each scenario, rounded up, and what that comes to (e.g. *5 / 36 × 25 kg = 125 / 900*). The Excel export has the supplier, part no., pack size, packs and order quantity columns. The material file has the three columns too (Korean headers 공급사, 품번, 포장 단위 work on import).
3. Tick a few rows (the box by the row number; the header box takes all rows shown) → **Edit selected…**: fill only what should change (e.g. supplier, overage %), *clear* empties a field → **Apply**. **Delete selected** removes them all (from recipes and backup lists too). ↶ takes either back.
4. **PFD › Units**: **⧉** on a row (or **Duplicate…** on a selected unit operation box) → code (e.g. `PROA2`), name, steps, BOM lines, and for the equipment either **new tags** (change `-1` to `-2`: XV-101 → XV-201, with a preview) or **the same equipment** (a second cycle on the same skid). The copy opens with its own Stream IDs (ST-PROA2-001 …); its steps use those streams and the new tags; transfers are not copied (draw them on the process map).

### What to check in N4.14 (step view on the PFD)

1. Open the downstream example, **PFD › PROA**: the inlet valves XV-101 … XV-105, the outlets XV-110 and XV-111, XV-120 and XV-121 are drawn on their lines with their tags.
2. **Step view** (top right of the drawing): a bar at the bottom right picks the step; ◀ ▶ go through them. In *3 · Load HCCF* XV-101 and XV-110 are green (open), the others grey, ▶ marks the valves switched at the start of the step, the HCCF line and the column waste are blue. The card at the bottom left lists the actions in order (▾ folds it) and the equipment of the step that is not drawn.
3. **Operations › PROA**: **Show on PFD** (next to the views) opens the drawing on step 1; each step's **⋯** menu has *Show on PFD* for that step.
4. In **Steps & actions**, point at an action: **‹ ›** move it earlier or later within its step (the order the operator follows); the step view card shows the new order.
5. The step view only draws on top of the drawing; nothing in the drawing changes, and it closes with **✕**.

### What to check in N4.13 (undo, redo, change log)

1. Open the downstream example. **Changes** (top bar) › *Your name*: type your name (it is written with each change; the same name as on Mass Balance).
2. **Materials**: change a name, click elsewhere, then **↶** (or Ctrl+Z with no text field selected): the whole typed name comes back in one step; **↷** (Ctrl+Y) redoes it.
3. **Operations**: add steps from a template, then ↶. **Materials › ⋯ › Replace…**, then ↶: the material list, BOM and MB come back (PFD links stay on the new material; the toast says so).
4. On the **PFD** tab Ctrl+Z is the drawing's own undo; the ↶ button still takes back the last change on the other screens. If the same data changed since (e.g. a tag given on the PFD), the undo is refused instead of overwriting it.
5. **Changes**: every change with time, name and what changed (materials added/changed, BOM lines per unit operation, steps, equipment, MB applied, unit operations added on the PFD, undo/redo). Search, filter, **Export to Excel**; the log is saved in the project file.

### What to check in N4.12 (Operations: steps and actions)

1. Open `examples/example-downstream.pcs.json` and the new **Operations** tab. PROA has 14 steps (Sanitize column … Stop): each with its minutes and start time, its **Streams** (e.g. *ST-PROA-001 HCCF load · 1,900 L*, the applied MB value) and its **actions** (*Close XV-102*, *Open XV-101*, *Start P-101*). Green = open / running.
2. **State table**: valves, pumps and agitators down, steps across. Bold = an action in that step, grey = kept from the step before. Click a cell to switch Open/Closed or On/Off; double-click to type a value (50 %, 150 rpm). The steps list changes with it.
3. **PFD › PROA**: the column, the VI vessel and the two filters carry tags (C-101, T-101, F-101, F-102) as the first line of their labels. Select a symbol: the panel has **Equipment tag** and the steps it is in; **Show in Operations** jumps to its row. Give another symbol a tag (e.g. a bag `BAG-101`): it joins the equipment list.
4. Pick **CEX** (no steps): **Add steps from a template** › *Chromatography, bind and elute*; add a stream to a step (**+ Stream**) and an action (**+ Action** › *New tag…* `XV-201` › **Open**).
5. **Equipment**: all tags, drawn or not (*Not drawn*), where they are used (click to jump). Rename a tag here and the PFD label follows.
6. **Export to Excel**: About, Equipment, Steps, Actions and *States PROA* (coloured). Change a state in the States sheet (열림/닫힘 work too) or the Actions list, then **Import from Excel…**: a preview says what changes; unit operations in the file get the file's steps. `examples/operations-downstream.xlsx` is the hand-written action list the example was made from.
7. **Save to file**: a project with operations is written as file v3 (an older app version refuses it instead of dropping the steps); a project without stays v2.

### What to check in N4.11 (materials that change)

1. Open `examples/example-downstream.pcs.json`. **Materials**: set `FLT-0001` to **Obsolete** (Status column). The top bar says *Link check: 1 to fix*; on the **BOM** the PROA line says *FLT-0001 is obsolete* with **Replace FLT-0001…**.
2. Add a material `FLT-0011` (EA), then **Replace FLT-0001…** → `FLT-0011`. The dialog lists what changes (BOM, recipes, PFD links, backups, MB) and offers to change the PCS_LINK rows of `MB_downstream.xlsx` too; *Mark obsolete* is the default. After it, the BOM has FLT-0011 from the MB (3 / 18), the link check is green, Materials shows *FLT-0001 → FLT-0011*, and Mass Balance › History has a line from *This app*.
3. Change the code of `BUF-1002` to `BUF-1002W` (click elsewhere). A yellow bar offers **Update the MB workbook too**: only the MatCode cells in PCS_LINK change; the applied values follow and stay applied.
4. With a revision saved before, **Compare** reads the renamed code as *Changed (code BUF-1002 → BUF-1002W)*.
5. Each Materials row has a **⋯** menu: *Where used*, *Replace…*, *Delete*. The material file has *Status* and *Replaced by* columns (Korean status words work on import: 사용 중, 검토 중, 단종).

### What to check in N4.10 (a BOM that keeps changing)

1. Open `examples/example-downstream.pcs.json`, go to **BOM**. Above the sections: **search** (code or name, also recipe parts), **category**, *To check*, *Manual lines*; ▾ folds a section (remembered in this browser).
2. **Save revision…** → *Rev A* with a note. Then change something: overage 10 % on `BUF-1002` (PROA), `BUF-2003` (CEX) *Not counted*. The lines say **▲ +90 / +660 since Rev A** and **Not counted since Rev A (was 450 / 3,600)**; the bar above says *0 added · 1 removed · 1 changed since Rev A*; *Changed since Rev A* shows only those.
3. Click that summary (or **Revisions** › *Compare*): totals (what to buy) and lines, before → after (change), **Export to Excel**. **Export to Excel** of the BOM is named `… BOM after Rev A <date>.xlsx` and has the *Changes* sheets.
4. **Where used**: click a material code on the BOM, or the **Used** number on Materials. Each place has a button: *Open in BOM*, *Show on PFD*, *Open recipe*, *Open backups*.

### What to check in N4.9 (batches, guide)

1. **Guide**: on the first visit the guide opens at the right (or click **? Guide** in the top bar). *Linking steps* shows the seven steps with what the project has now (Done / To do / Check / Waiting) and the next one open; each step's button goes to the right screen. *This screen* follows the screen on view; *Rules* is the one-page summary. **EN / 한국어** switches the language; open/closed and language are remembered in this browser.
2. Open `examples/example-downstream.pcs.json`: the guide says 7 of 7 done.
3. **BOM › PROA**: `BUF-1001-B` (equilibration buffer in 200 L bags, Sending) shows *Batches of 200 L: Sending 10 · Receiving 0* and 10 bags `CON-0004` under it; `BUF-1001-T` (2,000 L tank batches, Receiving) shows 8 batches and 8 filters `FLT-0007`. Both are made of `BUF-1001`, whose chemicals follow.
4. **Materials › Recipe (2) · 200 L** of `BUF-1001-B`: *Batch size*, a component counted *per batch*, *Make every batch in full*, and *Try it* (type a quantity, see the batches and what the BOM counts). Change the batch size to 100 and save: the BOM shows 20 bags.
5. In `MB_downstream.xlsx`, `MB_calc` row *Equilibration buffer in 200 L bags (1) or a 2,000 L tank (0)* chooses the way per scenario.

### What to check in N4.7 (resizing, PowerPoint export)

1. **PFD side panel**: drag its left edge (the line between the drawing and Symbols / Units / Streams). The symbol palette uses the room; the width is remembered in this browser. Double-click the edge for the default width; arrow keys work when it has focus.
2. **Columns**: on BOM, Mass Balance (stream values, material totals, changes) and Materials, drag the right edge of a column header. All BOM unit sections share the same widths. Widths are remembered in this browser; double-click a header edge for the automatic widths.
3. **PFD › Export to PowerPoint…**: pick the slides (process map, unit operations), *Editable shapes* or *Pictures*, and whether to add a stream table after each drawing. In PowerPoint, every box, line and text of an editable slide can be moved and retyped (a symbol is several shapes: select them and Group). Arrows are free-form lines with arrowheads that stop around their label, as on screen; they do not stay glued to the shapes when you move them.

### What to check in N4.6 (downstream example)

1. **Open** `examples/example-downstream.pcs.json`. The top bar shows **Linked**. The process map has seven unit operations in a row (PROA, CEX, MMC, VF, UFDF, FILL, STOR) with the applied MB values on the transfers (S = 2,000 L harvest, R = 15,000 L).
2. Open **PROA**: HCCF → Protein A column (equilibration, wash, elution and NaOH bags, waste to drain) → low-pH VI (titrant, neutralization) → depth filter (WFI flush) → 0.2 µm filter → connector to CEX. The other drawings follow the same idea.
3. **Mass Balance**: `MB_downstream.xlsx` is applied. Its `MB_calc` sheet holds the assumptions in yellow cells (scale, titer, column volumes, CV per step, loadings, filter capacities, UF/DF concentrations, fill volume); `PCS_LINK` has 69 rows (a flow row per stream, buffer volumes in L, filters and bottles in EA).
4. **BOM**: each buffer line (source MB) is followed by its chemicals (Recipe); filters and bottles come from the MB (they scale), sterile filters, the fill manifold, the logger and the transfer lines from PFD links, and the resins are manual lines (packed bed volume, with the reason). *Totals per material* lists the chemicals to buy, *Prepared in-house* the 12 buffers, *Backup materials* the alternates (NaCl and PS80 from supplier B, a 1.1 m² virus filter at ratio 3, an alternate Protein A resin).
5. To build the material list of your own downstream process, start from `examples/downstream-materials.xlsx` (sheets Materials, Recipes, Backups) and **Materials › Import**.

### What to check in N4.5 (buffer recipes and backup materials)

1. Open `examples/example-process.pcs.json`. On **Materials**, click **Add 15 missing sample(s)**: besides the lines and the transfer panel it adds buffer chemicals (MAT-0040 to MAT-0042), an equilibration buffer (MAT-0043) and two alternate-supplier materials (MAT-0044, MAT-0045), and gives MAT-0007 *Sodium Bicarbonate 7.5 %*, MAT-0011 *Citrate Buffer* and MAT-0043 their example recipe, MAT-0008 and MAT-0015 a backup.
2. Click **Recipe (2)** on MAT-0007: 75 kg MAT-0040 and 1000 L WFI per 1000 L. Try adding MAT-0007 to the recipe of one of its own components: a loop is refused.
3. **Mass Balance**: upload and apply `examples/MB_example_buffer.xlsx` (MB_example plus 2.8 / 14 L of MAT-0007 in ST-100L-001). *Material totals* says **Counted · recipe: 2 components**.
4. **BOM**, 100L: MAT-0007 (MB, marked *Prepared*), then **↳ MAT-0040 0.21 / 1.05 kg** and **↳ MAT-0012 2.8 / 14 L** (source *Recipe*). *Totals per material* buys MAT-0040 and WFI (column *From recipes*); MAT-0007 is under **Prepared in-house**.
5. Add **MAT-0043** to 100L by hand (200 / 1000 L, with a reason): Tris, NaCl and WFI follow; under NaCl, **⇄ MAT-0044** (backup, same quantity, in italics). **Backup materials** at the bottom sums it; it is not in the totals.
6. **+ Backup** (hover a BOM line) edits the backups of that material everywhere. **Export to Excel**: the BOM sheet has a *Row* column (Line, Recipe of …, Backup for …) and the sheets *Prepared* and *Backups*. **Materials › Export to Excel** has the sheets *Recipes* (columns Code, Name, Per, Unit, Component code, Component, Quantity, Component unit, Basis, Batch size, Whole batches, Note; *Basis* is `Per batch` or empty) and *Backups*; importing such a file sets them. Korean headers work too (제조품코드, 기준량, 원료코드, 수량, 산정기준, 배치크기, 전량조제 …).

### What to check in N4.4 (lines, transfer panel, more symbols)

1. **Symbols**: *Tank* is now **Hold vessel**. New groups **Connections & transfer** (transfer panel, U-bend jumper, aseptic connector, tri-clamp, tube weld, tube seal, flexible hose) and **Utilities & CIP** (CIP skid, WFI, clean steam, process gas, TCU, drain, vent); more valves (diaphragm, ball, butterfly, control, relief, steam trap, rupture disc, sight glass), upstream parts (sparger, agitator, vent filter, condenser, gas cylinder), bag manifold, hopper, chromatography system, lyophilizer, and level, DO, weight and gas-flow instruments.
2. **Materials**: the samples now include `1.5" Line` and `2" Line` in 1, 1.5, 2 and 2.5 m (MAT-0031 to MAT-0038) and **Transfer Panel** (MAT-0039). A list that already has the samples shows **Add n missing sample(s)**.
3. **Lines on the PFD**: select an arrow. Under *Lines and parts on this arrow*, link e.g. 1 × `1.5" Line 2 m`. It counts in the BOM of that unit operation (source PFD). On the process map, a line linked on a transfer arrow counts toward the transfer's destination.
4. Insert **Transfer panel** and link **MAT-0039 Transfer Panel**: a BOM line with source PFD.

### What to check in N4.3 (link check)

Open `examples/example-process.pcs.json`, upload and apply `MB_example.xlsx` on **Mass Balance**. The top bar shows **Linked**.

1. On the PFD, open **100L** and delete the arrow `ST-100L-002 / Feed A`. The top bar turns to **Link check: 1 to fix**. On **BOM**, MAT-0002 in 100L has no quantity and says *"… is not counted: ST-100L-002 is no longer on the PFD"*; a notice at the top says values were left out. Click the chip: the dialog lists the stream and its values, with **Open PFD**.
2. Undo on the PFD (click the drawing, Ctrl+Z): **Linked** again, MAT-0002 is 0.62 / 3.1 kg again.
3. In **Materials**, change MAT-0001's unit to `g`: its kg values from the MB leave the BOM with the reason; **Mass Balance** shows "Left out: unit differs from the material list" in the material totals. Change it back to `kg`.
4. On **Mass Balance**, **Replace…** with `MB_example_v2.xlsx` and do not apply: the PFD shows a banner and the BOM a notice (*the MB quantities are the ones applied before*) with **Review and apply**, which opens Mass Balance.
5. Draw a new arrow in a unit operation: the chip shows **Linked · 1 note** (a stream without an MB value). In the dialog, click the stream to see it on the PFD.

### What to check in N4.2 (symbols and GridCraft)

1. Open a unit operation's drawing. The **Symbols** tab now groups 50 symbols: Upstream, Vessels & bags (tank, jacketed and mixing vessels, 2D bag, 3D bag in tote, single-use mixer, bottle, waste), Filtration & clarification (filter, depth, 0.2 µm sterile, prefilter, virus filter, cartridge in housing, TFF, hollow fiber, membrane adsorber, centrifuge), Chromatography & purification (column, Protein A, IEX, HIC, multi-column, low-pH viral inactivation, UV-C), Pumps, valves & lines (pumps, 2- and 3-way, check and pinch valves, heat exchanger, static mixer, sampling point), Instruments (PI, FI, TI, pH, conductivity, UV), Fill & storage (filling, bulk DS, freezer). Type in **Search symbols**, e.g. "filter".
2. **Upload symbols…** and choose the files in `examples/symbols/` (two SVG pictures and an Excalidraw library with two items). They appear under **My symbols** and insert like the built-in ones: into the frame, with their name, and you can link materials to them (BOM source PFD).
3. Select shapes you drew (or a symbol), **Save as symbol…**, give a name and a category. Choosing a built-in category (e.g. *Filtration & clarification*) puts it next to the built-in symbols.
4. **My symbols n** lists your symbols to rename, recategorize or remove (copies already on drawings stay). **Export set** downloads them as one file; **Upload symbols…** with that file adds them to another project. Symbols are saved in the project file.
5. **Mass Balance** with no workbook: **New workbook in GridCraft** opens GridCraft inside the app with an empty `MB` sheet and a `PCS_LINK` sheet listing the PFD's Stream IDs; Ctrl+S saves it to the project and checks it. **Upload Excel workbook…** and **Download** still bring Excel files in and out. (GridCraft is about 21 MB, so it is not in the one-page preview; it runs on your PC and on GitHub Pages.)

### What to check in N4.1 (PFD per unit operation)

The PFD is now a **process map** plus **one drawing per unit operation**, each on its own tab above the board.

1. **Open** `examples/example-process.pcs.json`. The **Process map** tab shows a box per unit operation (`10L`, `100L`) and the transfer between them, `ST-10L-100L / Inoculum transfer`, plus the stream table of all streams.
2. Click the **10L** tab: the 10L frame with its bag and bioreactor, `ST-10L-001`, and an orange **connector** `To 100L / ST-10L-100L` right of the frame. The arrow from the bioreactor to the connector carries the transfer's ID and name; it has no ID of its own. The **100L** tab has the matching `From 10L` connector on the left.
3. On the process map, draw an arrow from one box to another: it becomes a transfer (`ST-<from>-<to>`), and the app adds a connector in both unit operation drawings. An arrow that does not run from box to box is a note.
4. Delete the transfer on the map: a connector with an arrow attached stays and reads `Not connected`; one without arrows disappears. Undo (Ctrl+Z): the transfer gets its ID back and the connectors are connected again.
5. Rename a unit operation in the **Units** list, by double-clicking its box (first line the code, then the name), or on its frame title. Box, frame, tab and connectors follow. Stream IDs never change.
6. **+ Unit operation** (tab bar) adds a box on the map and opens its new drawing. In **Units**, **×** deletes a unit operation (its drawing, box and BOM lines, after a confirmation); a unit operation whose box was deleted on the map is listed under *Not on the process map* with **Put back**.
7. Mass Balance values appear on every drawing's labels, transfers included. The BOM's PFD counts come from links on shapes in each unit operation's drawing (links on the map do not count).
8. A project file saved before this change (v1) opens converted: same Stream IDs, same BOM; transfers move to the map and keep a connector and arrow where they left and entered equipment.
9. The "PCS" mark at the top left is gone.

### What to check in N4

Start like N3: open `examples/example-process.pcs.json`; its three bags are linked to the sample bag materials (MAT-0017 50 L, MAT-0018 500 L).

1. **BOM** tab before any mass balance: the bags are already lines with source **PFD** (1 each).
2. Apply `MB_example.xlsx` on **Mass Balance**, back to **BOM**. Each unit operation lists its materials with the source and quantities. Check against a hand calculation:
   - 10L: MAT-0001 (MB) 0.1575 / 0.7875 kg (seed medium 9 L and 45 L × 17.5 g/L), MAT-0017 (PFD) 1 / 1
   - 100L: MAT-0001 (MB) 1.4875 / 7.4375 kg, MAT-0002 (MB) 0.62 / 3.1 kg, MAT-0017 and MAT-0018 (PFD) 1 / 1
   - **Totals per material**: MAT-0001 1.645 / 8.225 kg (10L + 100L), MAT-0017 2 / 2
3. **Overage**: in **Materials**, set 10 in MAT-0001's *Overage %*: every MAT-0001 line becomes ×1.1 (100L 1.6363 / 8.1813). Type 5 in one line's *Overage %* to override it for that line only; empty it to go back to the material's value.
4. **Add a material…** to 100L, e.g. MAT-0012 Water for Injection: a **Manual** line asks for both quantities and a reason, and is counted once they are filled in.
5. **Source**: switch a line between MB, PFD and Manual (the options show what each source has). Only the chosen source counts; the other is mentioned under the material. **Not counted** keeps the line visible but leaves it out of the totals. **Reset** goes back to the automatic choice.
6. **Export to Excel**: sheets *BOM* (every line: UO, material, source, source values, overage, quantities, reason), *Totals* and *About*.
7. Refresh the page or **Save to file** and open it again: your changes to lines stay.

### What to check in N3

Use the example files in `examples/`. They belong together: the project's Stream IDs are the ones the workbooks' `PCS_LINK` sheets use, and the material codes are the 18 sample materials.

1. **Open** `examples/example-process.pcs.json`: two unit operations (10L seed, 100L fed-batch) and four streams (`ST-10L-001`, `ST-10L-100L`, `ST-100L-001`, `ST-100L-002`), on the process map and the two unit operation drawings.
2. **Mass Balance** tab → **Upload Excel workbook…** → `MB_example.xlsx`. The check shows 0 errors, 4 flow rows and 3 material rows, and the preview lists the 7 values to apply. **Apply to PFD and BOM**.
3. **PFD** tab: each label now reads ID, name and values, e.g. `ST-100L-001 / Basal medium / S 85 · R 425 L` (in the 100L drawing) and `ST-10L-100L / Inoculum transfer / S 10 · R 50 L` (on the map and on the arrows to its connectors). The stream table gains Unit, Sending and Receiving. Select an arrow: the panel shows its flow and material rows.
4. **BOM** tab: the materials of the MB are BOM lines with source MB (see N4).
5. Back on **Mass Balance**: **Replace…** with `MB_example_v2.xlsx` (the Receiving working volume is 1000 L instead of 500 L). The preview shows each change as `425 → 850`. Apply it; **History** gets a second line with file, application, your name and SHA-256.
6. **Replace…** with `MB_example_errors.xlsx`: 7 errors (one per row, V1–V7) with their cells, and **Apply** stays off. The applied values do not change.
7. **Edit in GridCraft** (PC or GitHub Pages): the workbook opens inside the app. Change a value in `MB_calc`, press **Ctrl+S**: the bar shows "Saved to project" and the result of the check. **Done** closes it; **Apply** takes the new values. Closing with unsaved changes asks first.
8. **PFD labels show** (under Applied values): all scenario values, the active scenario only, or no values.
9. **Download PCS_LINK sheet** gives a sheet with the PFD's Stream IDs filled in, to copy into your own workbook. Without GridCraft: **Download**, edit in Excel, save, **Replace…**.
10. **Save to file** and open it again (or refresh): the workbook, the applied values and the history travel with the project.

### What to check in N2

(Updated for N4.1: unit operations now have their own drawings.)

1. **Units** tab (right panel): type "100L Bioreactor", **Add**; then "Harvest clarification", **Add**. Each unit operation gets a box on the process map (`100L / 100L Bioreactor`, `HARVE / Harvest clarification`) and its own drawing tab, with a frame titled `<code> · <name>`.
2. Open a unit operation's tab. **Symbols** tab: click **Bioreactor**, **Single-use bag**, **Depth filter**… Symbols land in the frame in the middle of the view, next to what is already there.
3. Draw arrows with the arrow tool (A):
   - in a unit operation drawing, with an end in the frame → `ST-100L-001`, `ST-100L-002`… (a feed or waste line with one loose end counts too)
   - on the process map, from one box to another → transfer `ST-100L-HARVE` (a second one between the same two boxes → `ST-100L-HARVE-2`)
   - to or from a connector (orange box, drawn by the app for each transfer) → part of that transfer, labelled with its ID
   - anywhere else → no ID (a note)
   The ID appears as a blue label on the arrow; labels are locked so they are not edited by accident.
4. Select an arrow: the panel shows its ID and route. Type a **Stream name** and press Enter; the label shows ID and name. Tick **Not a process stream** for lines that are only drawing.
5. Delete an arrow, then undo (Ctrl+Z): the same ID comes back. A deleted ID is never handed out again. Copy an arrow (Ctrl+D or copy/paste): the copy gets a new ID. Undo works within the drawing on screen (switching tabs starts a new undo history).
6. Add materials in the **Materials** tab (e.g. the 18 samples). Then, in a unit operation drawing, select a symbol, pick a material under **Material to link**, **Link**, and set the count (e.g. 2 bags). Counts per unit operation are what the BOM uses in N4.
7. **Streams** tab: the list of all streams (click one to jump to it, on whichever drawing it is), **Copy list** (paste into Excel), and **Insert stream table**: on the map it lists all streams, in a unit operation drawing that unit's streams and transfers; it updates itself. **Insert table** (Symbols tab) adds a free table you edit in the panel.
8. Refresh the page or **Save to file** and open it again: drawings, IDs, names, links and tables are all kept.

### What to check in N1

- **Autosave**: change the project name or draw something, refresh the page, and the work is still there. The top bar shows "Autosaved hh:mm:ss".
- **Project file**: **Save to file** (Ctrl+S) downloads `<process name>.pcs.json`; **Open** loads it back; **New** asks before discarding changes that are not in a file.
- **Materials**: **Add 18 sample materials**, edit a cell, give two materials the same code (both turn red). **Import Excel/CSV** with `examples/materials-import-example.xlsx`: the preview shows 3 new, 1 updated, 1 unchanged and 1 skipped row before anything changes. **Export to Excel**.
- **PFD board**: shapes, arrows, pen, text, images, the library, image export of the drawing on screen (main menu › Save as image; tables are included). Strokes are straight and arrows are routed at right angles by default.

## Stream ID rules

| Arrow | ID | Example |
| --- | --- | --- |
| In a unit operation's drawing, with at least one end in its frame (a drawing without a frame: every arrow) | `ST-<UO>-<nnn>` | `ST-100L-001` |
| On the process map, from one unit operation box to another | `ST-<from>-<to>`, then `-2`, `-3`… | `ST-100L-HARVE` |
| In a unit operation's drawing, to or from a connector | the connector's transfer ID (no ID of its own) | `ST-100L-HARVE` |
| Anywhere else | none | — |

An end belongs to a frame (or box) when the shape it is attached to is in that frame (or is that box), or, for a loose end, when the end point lies inside it. IDs are issued once per project and kept in the project file: deleted IDs are retired, undo restores them, and a transfer redrawn between the same two boxes gets its old ID back. Unit operation codes are 1–10 letters or digits with at least one letter; changing a code does not change IDs already issued.

The app keeps a connector in each unit operation drawing for every transfer into or out of it (`From <UO>` on the left of the frame, `To <UO>` on the right). Move connectors freely. A deleted connector comes back while its transfer exists; when a transfer is deleted, its connectors go too, except those with arrows attached, which stay as `Not connected` until the transfer is drawn again or you delete them.

## The `PCS_LINK` sheet

The app reads one sheet of the engineer's MB workbook, named exactly `PCS_LINK`. Row 1 holds the headers (any order); every other row is one value.

| Header | Required | Content |
| --- | --- | --- |
| `StreamID` | yes | A Stream ID from the PFD |
| `MatCode` | material rows | Empty for the stream's **flow row** (its value goes on the PFD label); a material code for a **material row** (its value goes to the BOM of that stream's unit operation, or of the destination of a transfer) |
| `Unit` | yes | The flow's unit (L, kg …); for a material row, the unit of the material list |
| `Sending` | yes | Value, or a formula into the calculation sheets |
| `Receiving` | no | Value or formula |
| `Note` | no | Free text |

Formulas must have their results saved in the file: Excel and GridCraft do that when they save. The checks:

| Rule | Check | Level |
| --- | --- | --- |
| V1 | `PCS_LINK` sheet, required headers and cells are there | error |
| V2 | The Stream ID is a stream on the PFD | error |
| V3 | Every PFD stream has a flow row | warning |
| V4 | One flow row per stream | error |
| V5 | Values are numbers ≥ 0; formulas have saved results (never read as 0) | error |
| V6 | `MatCode` is in the material list | error |
| V7 | A material row's unit is the material list's unit | error |
| V8 | A unit operation's material is not also counted from PFD links (no double counting) | error |

Nothing is applied while there is an error; warnings are shown and can be applied.

## Link check

The PFD makes the Stream IDs and unit operations, the Mass Balance gives values per Stream ID, the material list gives codes and units, and the BOM adds them up. Applied MB values are a snapshot, so they are checked against the current PFD and material list on every change:

| Applied MB row | In the BOM |
| --- | --- |
| Stream on the PFD, material in the list, same unit | counted |
| Stream no longer on the PFD (deleted, or redrawn with a new ID) | left out; the line and the link check say why. Undo on the PFD brings the ID and the value back |
| Material not in the list (code changed or deleted) | left out, listed at the top of the BOM |
| Material now counted in another unit | left out; fix the unit in the list or in `PCS_LINK` |

The top bar shows **Linked**, **Linked · n notes** (streams without MB values, a material both in the MB and linked on the PFD, a stream whose MB rows list a solution and also one of its chemicals) or **Link check: n to fix** (values left out, a workbook changed but not applied, a recipe loop, an obsolete material still used, an equipment tag on two PFD shapes, a step naming a stream its unit operation does not have). The dialog lists each item with a button to the screen that fixes it.

## BOM rules

- A line is one material in one unit operation, for each scenario (Sending, Receiving). It takes its quantity from **one** source:

  | Source | Quantity before overage |
  | --- | --- |
  | MB | Σ `PCS_LINK` material rows of that unit operation and material in the applied mass balance (a transfer's rows count for its destination) |
  | PFD | Σ counts linked on shapes and arrows (lines) in that unit operation's drawing, plus lines linked on transfer arrows of the process map that end in it (the same for every scenario; other links on the map do not count) |
  | Manual | Numbers entered on the BOM screen, with a reason |

- Quantity = source value × (1 + overage / 100). A line's overage, when set, overrides the material's *Overage %* (default 0).
- The app lists every material the applied MB or the PFD links have for a unit operation, plus the ones you add. Default source: MB when the MB has it there; else PFD when it is linked there and counted in pieces (EA, pcs, set); else Manual. A line is stored only once you change it.
- Lines that need attention (no value from the source, a manual line without numbers or a reason) are marked and counted at the top. A total with a missing line shows "≥".
- **Prepared materials** (a material with a recipe on the Materials screen: a buffer, a medium, a stock solution made in-house): every counted line of it is followed by its components, quantity = line quantity (with its overage) × recipe quantity ÷ recipe amount, plus the component's own default overage. Recipes can be nested (a stock solution in a buffer); loops are refused. *Totals per material* lists what to buy (lines and components of materials without a recipe); prepared materials are listed under *Prepared in-house*. When the MB rows of one stream list a solution and also one of its chemicals, the line says it may be counted twice (the same chemical on another stream, e.g. WFI for a flush, is not a double count).
- **Batches**: a recipe with a *batch size* (one preparation: a bag, a tank batch) counts batches = ⌈line quantity ÷ batch size⌉ for each line (rounded up; nothing = 0 batches). A component counted **per batch** (the bag, a filter per preparation) is batches × its quantity; the other components stay proportional, or, with *Make every batch in full*, are counted for batches × batch size. A per-batch component without a batch size: each line is one batch. Example: 1,980 L in 200 L bags = 10 batches = 10 bags; 14,520 L in 2,000 L tank batches = 8 batches = 8 filters. The BOM line, *Prepared in-house* and the Excel file (BOM and Prepared sheets) show the batches.
- **One composition, several ways of preparing it**: keep one code for the solution (`BUF-1001`, its chemicals per 1000 L) and one code per way of preparing it (`BUF-1001-B` in bags, `BUF-1001-T` in a tank) whose recipe is the solution plus its consumables per batch. The MB says which one each scenario uses (two `PCS_LINK` rows on the stream, 0 for the other scenario).
- **Material status and replacement**: an *Obsolete* material that a counted line, a recipe, an MB row or a PFD link still uses is flagged on the BOM line (with *Replace…*) and in the link check. *Replace…* swaps the material in stored BOM lines (a line the new material already has in that unit operation wins), recipes (quantities × factor when the units differ), PFD links, backup lists and, when the units match, the PCS_LINK MatCode cells of the MB workbook; the old material is marked obsolete (*replaced by*), deleted or kept. Changing a code offers to change the PCS_LINK cells too. The workbook edit touches only those cells (inline strings); a MatCode cell with a formula is left alone and reported.
- **Revisions**: *Save revision…* keeps the counted lines and the totals (to buy, prepared) by unit operation and material **code**, per scenario, in the project file. The BOM marks lines changed since the newest revision (or one you pick): ▲/▼ change, *New*, *Not counted since*, and removed lines in red. *Compare* lists added / removed / changed lines and totals (a material whose code changed reads as removed + added); the Excel export of the BOM adds the *Changes* sheets.
- **Backup materials** (alternates: another supplier or part): listed under every line and component of their primary with quantity = primary quantity × ratio (default 1); summed under *Backup materials*, never added to the totals.

## Buffers and other chemicals: from Materials to the BOM

| Where | What you do |
| --- | --- |
| Materials | The chemicals (kg) and the buffer itself (L). Give the buffer a **Recipe**: e.g. per 1000 L: 2.423 kg Tris, 8.766 kg NaCl, 1000 L WFI. Add **Backups** to a chemical if another supplier can replace it. |
| PFD | Draw the buffer where it goes in: an arrow into the chromatography (or a buffer preparation unit and a transfer to it). The arrow gets its Stream ID, e.g. ST-CHR-003. |
| Mass Balance | One `PCS_LINK` material row for that stream: `ST-CHR-003`, `BUF-code`, `L`, Sending, Receiving. (Or list the chemicals in kg directly, without a recipe; not both.) |
| BOM | The buffer line (from the MB), its chemicals below it (from the recipe), the chemicals in *Totals per material*, the buffer under *Prepared in-house*, backups apart. |

## Saving

- **Autosave**: every change is written to the browser (IndexedDB) and restored on the next visit, including a change made just before the tab is closed. It stays on that PC and that browser.
- **Project file**: `<process name>.pcs.json` holds everything (PFD process map and drawings, your symbols, materials, the MB workbook, applied MB values and their history, BOM, equipment and operations). Use it to move work to another PC or to share it. Files from before N4.1 (format v1, one PFD board) open converted to the process map and per-unit drawings. A project with equipment or steps is written as v3 (N4.12 and later); one without stays v2.

## Development

```
npm install
npm run gridcraft      # once: GridCraft web 0.13.0 (official release, unmodified) into public/gridcraft/
npm run dev            # http://localhost:5173 (development; on Windows antivirus can lock node_modules/.vite)
npm run build && npm run serve   # the built app at http://localhost:5173, as start-windows.cmd runs it
npm test               # unit tests (vitest)
npm run build          # dist/ for GitHub Pages (includes public/gridcraft/ when it is there)
npm run build:preview  # dist-preview/index.html, a single-file preview (no GridCraft)
```

Browser tests run against a built app (`npm run build`, then `npx vite preview`):

```
LANG=C.UTF-8 node tools/smoke.mjs http://localhost:4173/       # N1: autosave, files, materials
LANG=C.UTF-8 node tools/smoke-pfd.mjs http://localhost:4173/   # N2/N4.1: process map, UO drawings, connectors, Stream IDs, tables
LANG=C.UTF-8 node tools/smoke-mb.mjs http://localhost:4173/    # N3: Mass Balance with the examples and GridCraft
LANG=C.UTF-8 node tools/smoke-bom.mjs http://localhost:4173/   # N4: BOM against a hand calculation, edits, Excel export
LANG=C.UTF-8 node tools/smoke-symbols.mjs http://localhost:4173/  # N4.2: symbol palette, uploads, save as symbol, symbol sets
LANG=C.UTF-8 node tools/smoke-link.mjs http://localhost:4173/     # N4.3: link check between PFD, MB, BOM and materials
LANG=C.UTF-8 node tools/smoke-recipes.mjs http://localhost:4173/  # N4.5: buffer recipes and backup materials, Materials to BOM
LANG=C.UTF-8 node tools/smoke-layout.mjs http://localhost:4173/   # N4.7: panel and column resizing, PowerPoint export (both modes)
LANG=C.UTF-8 node tools/smoke-guide.mjs http://localhost:4173/    # N4.9: in-app guide, batches (bags and filters rounded up)
LANG=C.UTF-8 node tools/smoke-revisions.mjs http://localhost:4173/ # N4.10: BOM search/filters/folding, revisions and compare, Where used
LANG=C.UTF-8 node tools/smoke-materials.mjs http://localhost:4173/ # N4.11: material status, Replace (with the MB workbook and PFD links), code change into the MB workbook
LANG=C.UTF-8 node tools/smoke-operations.mjs http://localhost:4173/ # N4.12/N4.14: steps and actions, state table, tags on the PFD, step view, action order, Excel export/import
LANG=C.UTF-8 node tools/smoke-history.mjs http://localhost:4173/    # N4.13: undo/redo outside the drawing, the change log
LANG=C.UTF-8 node tools/smoke-purchasing.mjs http://localhost:4173/ # N4.15: purchasing columns and packs, editing many materials, duplicating a unit operation
LANG=C.UTF-8 node tools/smoke-scenarios.mjs http://localhost:4173/  # N4.16: a third scenario from a new PCS_LINK column, remove and undo, the material view
LANG=C.UTF-8 node tools/smoke-n51.mjs http://localhost:4173/        # N5.1: top bar at four screen sizes, Start here and the examples, fitted drawings, Fit, folded explanations, dialogs
LANG=C.UTF-8 node tools/smoke-n53.mjs http://localhost:4173/        # N5.3: Materials, BOM, Operations sheets, letters and row numbers, formula bar editing, ribbon filters
LANG=C.UTF-8 node tools/smoke-n54.mjs http://localhost:4173/        # N5.4: one-line BOM rows, corner marks, Batches column, Operations drop-down cells (click, Alt+↓, F2, Esc, opens upwards)
LANG=C.UTF-8 node tools/smoke-n55.mjs http://localhost:4173/        # N5.5: Start here without the example up front, the example as a view (bar, reload, Close, undo kept, Keep as my project), New without samples
LANG=C.UTF-8 node tools/smoke-resize.mjs http://localhost:4173/     # N5.5.1: every symbol line measured from its points; Filter, Prefilter, Depth and Sterile filter dragged bigger keep their shape
LANG=C.UTF-8 node tools/smoke-n52.mjs http://localhost:4173/        # N5.2: ribbon per screen, Excel/PowerPoint colours, cell selection sums, Ctrl+C, zoom, one-line ribbon
LANG=C.UTF-8 node tools/smoke-pptx-pictures.mjs http://localhost:4173/ # N5.1.1: PowerPoint export with a stream table picture (the small example), both modes
```

**Do the symbols look the same in PowerPoint?** — `tools/compare-symbols-pptx.mjs` lays the built-in symbols out 12 per sheet at their drawing size, pictures each sheet as the editor draws it and as the PowerPoint export draws it (rendered by LibreOffice), and `tools/compare-symbols-sheet.py` scores each symbol's overlap and writes side-by-side sheets, lowest first. Run it after changing a symbol or the exporter (needs LibreOffice, poppler's `pdftoppm` and Python with Pillow):

```
LANG=C.UTF-8 node tools/compare-symbols-pptx.mjs http://localhost:4173/ /tmp/symbols   # report.txt and compare-*.png there
```

**Linkage check for changes to the screens** — `tools/linkage-snapshot.mjs` records everything the linkage produces for a project (the saved file without views and times, the BOM, Materials, Operations and applied-MB Excel exports, the PowerPoint text, the link check, every PFD label). Take one before and one after a change and compare; a change meant for the screens only must leave them identical:

```
LANG=C.UTF-8 node tools/linkage-snapshot.mjs http://localhost:4173/ before.json examples/example-downstream.pcs.json
#   … change, build …
LANG=C.UTF-8 node tools/linkage-snapshot.mjs http://localhost:4173/ after.json examples/example-downstream.pcs.json
node tools/linkage-snapshot.mjs --compare before.json after.json    # IDENTICAL, or each difference
```

The other smoke tests run with the guide closed (they set `pcs.guide.open` before the page loads).

The examples are made by tools: `tools/make-mb-examples.py` writes the workbooks' formulas and `gridcraft-cli` calculates and saves them (see the script's header), `tools/make-mb-buffer-example.mjs` adds the solution row to make `MB_example_buffer.xlsx`; `tools/make-downstream-examples.py` writes the downstream material file and MB (LibreOffice or GridCraft calculates it) and `tools/make-downstream-project.mjs` draws `example-downstream.pcs.json`, then `tools/make-operations-example.mjs` writes `operations-downstream.xlsx` and `tools/add-operations-example.mjs` tags four PROA shapes and imports it; `tools/make-example-project.mjs` draws `example-process.pcs.json` in the app.

Pushing to `main` runs `.github/workflows/pages.yml`: type check, tests, then a build that includes the official GridCraft web build (v0.13.0), unmodified, under `/gridcraft/`, so the app and GridCraft share one origin, and the deploy to GitHub Pages.

**Releases** — the version is `package.json`'s (shown as N5.1 for 5.1.0 in the Guide panel and on Start here). Every push to `main` also runs `.github/workflows/release.yml`: when there is no release `v<version>` yet, it runs the same tests and build, `tools/make-pc-zip.sh` packs the repository files and the built app into `pcs-platform-v<version>.zip` (folder `pcs-app`, `start-windows.cmd` with Windows line endings), and it publishes the release with `.github/release-notes.md` (GitHub creates the tag). So a new PC zip = raise the version in `package.json` and push.

GridCraft runs in an iframe in its host mode (`gridcraft/index.html?host=parent&chrome=nofiletab`): the app sends the workbook (`gridcraft:open`) when GridCraft is ready, and stores what GridCraft saves (`gridcraft:save`); see `src/mb/gridcraft.ts`.

## Layout

| Path | Contents |
| --- | --- |
| `src/model/` | Project format (`types.ts`), file reading and checks (`project.ts`), undo/redo and the change log (`history.ts`), ID rules (`ids.ts`), material import and the Recipes/Backups sheets (`materials.ts`), recipes and backups (`recipes.ts`) |
| `src/guide/` | In-app guide: status of the seven linking steps (`status.ts`, pure) and its English/Korean text (`content.ts`); the panel is `src/views/Guide.tsx` |
| `src/storage/` | Autosave (IndexedDB), file download and file picker |
| `src/xlsx/` | XLSX read/write with ExcelJS; tells formula cells without a saved result apart from zero |
| `src/ops/` | Operations: equipment types and states, the state table read from the actions, cell edits, templates, streams of a unit operation (`model.ts`, unit tested); Excel export and import (`xlsx.ts`) |
| `src/link/` | Link check: each applied MB row against the current PFD and material list, findings for the top bar (`check.ts`, unit tested) |
| `src/bom/` | BOM: lines per unit operation from the MB, PFD links and manual lines, overage, recipe explosion, backups, totals (`model.ts`, unit tested) |
| `src/mb/` | Mass Balance: `PCS_LINK` reader and checks V1–V8 (`pcsLink.ts`), change preview, totals and label values (`model.ts`), GridCraft host messages (`gridcraft.ts`) |
| `src/ui/` | Dialogs, toasts, and sizes the user drags (`resize.tsx`: PFD side panel, table columns) |
| `src/pfd/` | PFD logic: PowerPoint export (`pptx.ts`: drawing → shapes, stream tables, deck with PptxGenJS), Stream ID, UO and connector sync over the process map and every drawing (`sync.ts`, pure and unit tested), project file v1 conversion (`migrate.ts`), app-drawn shapes (`shapes.ts`), built-in symbols (`symbols.ts`) and the user's own (`customSymbols.ts`), tables, placement, Excalidraw helpers, side panel |
| `src/views/` | Screens: PFD board, Operations, Mass Balance (and the GridCraft overlay), BOM, materials |
| `test/` | Unit tests; `fixtures/xlsx` holds workbooks saved by GridCraft and LibreOffice in N0, `fixtures/example-v1.pcs.json` the example project in the old format |
| `src/examples.ts` | The examples the app offers on **Start here**; `tools/copy-examples.mjs` copies them from `examples/` into the build (`public/examples/`, not committed) |
| `examples/` | Files to try the app with: an upstream example project, its MB workbook (a v2, one with errors, and `MB_example_buffer.xlsx` with a solution made in-house), a material list to import; the downstream example (`example-downstream.pcs.json`, `MB_downstream.xlsx`, `downstream-materials.xlsx`, `operations-downstream.xlsx`); and `symbols/` (pictures and an Excalidraw library to upload as symbols) |
| `start-windows.cmd` | Double-click launcher for Windows: serves the built app (`dist/`) with `tools/serve.mjs` and opens the browser; builds it once when `dist/` is missing |
| `tools/` | GridCraft and font fetching, preview page, browser tests (`smoke*.mjs`), example generators |

## License

MIT. Main dependencies: React (MIT), Excalidraw (MIT), ExcelJS (MIT), JSZip (MIT), PptxGenJS (MIT, loaded only when exporting to PowerPoint), GridCraft web (MIT OR Apache-2.0, official build deployed unmodified, with its own license files), Fluent UI System Icons (MIT, Microsoft; the ribbon icons, copied as path data in `src/ui/icons.tsx`). The build tool lightningcss is MPL-2.0 and is not part of the deployed app.
