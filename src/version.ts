/** Which version of the app this is (package.json, set at build time) and where to get the others. */
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
export const BUILD_DATE: string = typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "";

/** "5.1.0" → "N5.1", "5.1.2" → "N5.1.2": the stage names used in the manual and the notes. */
export function versionLabel(v = APP_VERSION): string {
  const [maj = "0", min = "0", patch = "0"] = v.split(".");
  return `N${maj}.${min}${patch !== "0" ? `.${patch}` : ""}`;
}

export const REPO_URL = "https://github.com/Sisboombah0111/pcs-platform";
export const SITE_URL = "https://sisboombah0111.github.io/pcs-platform/";
/** The newest release: its PC zip (built app + start-windows.cmd). */
export const RELEASES_URL = `${REPO_URL}/releases/latest`;

/** Where this copy runs: the site, the PC version (start-windows.cmd on this computer), or elsewhere. */
export function whereRunning(): "site" | "pc" | "other" {
  const h = typeof location === "undefined" ? "" : location.hostname;
  if (h.endsWith("github.io")) return "site";
  if (h === "localhost" || h === "127.0.0.1") return "pc";
  return "other";
}
