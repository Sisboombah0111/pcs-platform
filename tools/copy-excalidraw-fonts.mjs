// Copy Excalidraw's drawing fonts into public/excalidraw/fonts so the app never fetches them from a CDN.
// Includes Xiaolai (CJK, ~13 MB split by Unicode range; the browser fetches only the slices it needs).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
const dst = "public/excalidraw/fonts";
if (!existsSync(src)) throw new Error(`${src} not found — run npm install first`);
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
const families = readdirSync(src);
for (const f of families) cpSync(join(src, f), join(dst, f), { recursive: true });
console.log(`excalidraw fonts → ${dst}: ${families.join(", ")}`);
