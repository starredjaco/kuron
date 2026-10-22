// Builds the browser version into one page: web/dist/kuron.html (the Claude artifact) and copies the
// face into site/ for the replay. Usage: node tools/build-web.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = p => readFileSync(join(ROOT, p), "utf8");
const preload = { systems: [{ id: "clinic-en", idea: r("examples/clinic.kuron"), data: JSON.parse(r("web/examples/clinic.world.json")) }] };
// keep the inlined code from closing its own <script> element
const safe = s => s.replace(/<\/(script)/gi, "<\\/$1");
const page = r("web/shell.html")
  .replace("/*@face.css*/", () => r("web/face.css"))
  .replace("/*@preload*/", () => safe(JSON.stringify(preload)))
  .replace("/*@face.js*/", () => safe(r("web/face.js")))
  .replace("/*@kuron.js*/", () => safe(r("web/kuron.js")))
  .replace("/*@app.js*/", () => safe(r("web/app.js")));
mkdirSync(join(ROOT, "web", "dist"), { recursive: true });
writeFileSync(join(ROOT, "web", "dist", "kuron.html"), page);
// a local preview with the skeleton the artifact host adds
writeFileSync(join(ROOT, "web", "dist", "preview.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${page}</body></html>`);
copyFileSync(join(ROOT, "web", "face.js"), join(ROOT, "site", "face.js"));
copyFileSync(join(ROOT, "web", "face.css"), join(ROOT, "site", "face.css"));
console.log("web/dist/kuron.html", (page.length / 1024).toFixed(0) + " KB");
