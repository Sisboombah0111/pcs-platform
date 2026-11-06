// Copy the example files the app offers (src/examples.ts) into public/examples, so they are part of the build and
// open from the app on the site and on a PC without going to GitHub. public/examples is not committed: examples/ is.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const listed = [...readFileSync("src/examples.ts", "utf8").matchAll(/file:\s*"([^"]+)"/g)].map((m) => m[1]);
const dst = "public/examples";
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of listed) {
  const src = join("examples", f);
  if (!existsSync(src)) throw new Error(`${src} is listed in src/examples.ts but missing`);
  copyFileSync(src, join(dst, f));
}
console.log(`examples → ${dst}: ${listed.join(", ")}`);
