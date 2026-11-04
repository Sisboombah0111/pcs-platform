// Turn dist-preview/index.html (one self-contained file) into page content for a claude.ai artifact:
// the artifact host adds its own <html>/<head>/<body>, so keep only title, style, root and script.
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("dist-preview/index.html", "utf8");
const title = /<title>[^<]*<\/title>/.exec(src.slice(0, 4000))?.[0];
const sStart = src.indexOf('<script type="module" crossorigin>');
const sEnd = src.indexOf("</script>", sStart);
// The bundle's text contains "<style>"/"</head>" strings; the real style block comes after the script.
const styleStart = src.indexOf("<style", sEnd);
const styleEnd = src.indexOf("</style>", styleStart);
if (!title || sStart < 0 || sEnd < 0 || styleStart < 0 || styleEnd < 0) throw new Error("unexpected preview layout");
const script = src.slice(sStart, sEnd + "</script>".length).replace(" crossorigin", "");
const style = src.slice(styleStart, styleEnd + "</style>".length);
// Bundled libraries contain literal U+FFFD in strings and regexes; write it as a JS escape instead.
const page = `${title}\n${style}\n<div id="root"></div>\n${script.replaceAll("\uFFFD", "\\uFFFD")}\n`;
writeFileSync("dist-preview/pcs-platform-preview.html", page);
console.log("dist-preview/pcs-platform-preview.html", (page.length / 1e6).toFixed(2), "MB");
