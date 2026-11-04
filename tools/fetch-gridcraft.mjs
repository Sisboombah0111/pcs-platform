// Put the official GridCraft web build, unmodified, in public/gridcraft/ so that `npm run dev` and
// `npm run build` serve it next to the app, the way the GitHub Pages deployment does.
//   node tools/fetch-gridcraft.mjs              download the release from GitHub
//   node tools/fetch-gridcraft.mjs <file.zip>   use a release zip you downloaded yourself
//   add --force to replace a copy that is already there
// The version matches GRIDCRAFT_VERSION in .github/workflows/pages.yml.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import JSZip from "jszip";

const VERSION = "0.13.0";
const RELEASE = `https://github.com/storytold/gridcraft/releases/download/v${VERSION}/gridcraft-web-${VERSION}.zip`;
const DEST = resolve("public/gridcraft");
const args = process.argv.slice(2);
const force = args.includes("--force");
const zipPath = args.find((a) => !a.startsWith("--"));

if (existsSync(join(DEST, "index.html")) && !force) {
  console.log(`GridCraft is already in ${DEST} (use --force to replace it).`);
  process.exit(0);
}

let bytes;
try {
  if (zipPath) bytes = readFileSync(zipPath);
  else {
    console.log(`Downloading GridCraft web ${VERSION} from GitHub…`);
    const res = await fetch(RELEASE, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  }
} catch (e) {
  console.error(`Could not get GridCraft (${e.message}).`);
  console.error(`The app works without it: on the Mass Balance screen, use Download, edit in Excel, then Replace.`);
  console.error(`To add GridCraft by hand, download ${RELEASE}`);
  console.error(`and run: node tools/fetch-gridcraft.mjs <path to the zip>`);
  process.exit(1);
}

const zip = await JSZip.loadAsync(bytes);
// The release holds one folder (gridcraft-web-<version>/) with index.html at its top.
const index = Object.keys(zip.files).filter((n) => /(^|\/)index\.html$/.test(n)).sort((a, b) => a.length - b.length)[0];
if (!index) { console.error("This zip has no index.html: it is not a GridCraft web build."); process.exit(1); }
const prefix = index.slice(0, -"index.html".length);
rmSync(DEST, { recursive: true, force: true });
let count = 0;
for (const [name, entry] of Object.entries(zip.files)) {
  if (entry.dir || !name.startsWith(prefix)) continue;
  const out = resolve(DEST, name.slice(prefix.length));
  if (!out.startsWith(DEST + sep)) continue; // ignore paths that would leave the folder
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await entry.async("nodebuffer"));
  count++;
}
const sha = createHash("sha256").update(bytes).digest("hex");
console.log(`GridCraft web ${VERSION}: ${count} files in ${DEST} (zip SHA-256 ${sha}).`);
