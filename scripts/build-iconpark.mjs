#!/usr/bin/env node
/**
 * Builds the local ByteDance IconPark set.
 *
 * Reads `@icon-park/svg` from `node_modules` (Apache-2.0, pinned by package-lock) and writes
 * `icons/iconpark.json` — 2658 icons stored locally, so the plugin needs no network and does not
 * depend on whatever icon set Obsidian happens to ship.
 *
 * Decisions worth stating:
 *
 * 1. **A JSON asset, not a TS module.** The set is ~1.2 MB; embedding it in `main.js` makes Obsidian
 *    parse it on every plugin load. As a sibling file it is read once, on first use.
 *
 * 2. **The four themes are free.** IconPark renders one static template against a four-slot colour
 *    palette; `outline` / `filled` / `two-tone` / `multi-color` are four colour *mappings* over that
 *    template, not four drawings. So each icon is rendered once with the sentinel colours `C0..C3`
 *    and those sentinels are kept in the stored markup — a theme is applied at display time by
 *    substituting four colours. One stored icon serves all four.
 *
 *    Rendering with `multi-color` specifically matters: it is the only theme whose four slots come
 *    straight from `fill`. `outline`, for instance, puts `none` in both slot 1 and slot 3, which
 *    would leave the stored markup ambiguous.
 *
 * 3. **Inheritable attributes are hoisted.** `stroke-width`, `stroke-linecap` and `stroke-linejoin`
 *    repeat on every path of every icon and are identical within an icon, so they are stripped from
 *    the paths and reapplied on the root `<svg>` — worth roughly 400 KB across the set.
 *
 * Usage: node scripts/build-iconpark.mjs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ICONS_DIR = path.join(ROOT, "node_modules", "@icon-park", "svg", "lib", "icons");
const OUT_DIR = path.join(ROOT, "icons");
const OUT_FILE = path.join(OUT_DIR, "iconpark.json");

const PKG_VERSION = "1.4.2";

const RENDER_PROPS = {
  size: 48,
  strokeWidth: 4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  theme: "multi-color",
  fill: ["C0", "C1", "C2", "C3"],
};

/** Identical on every path of every icon, so hoisted to the root <svg>. */
const HOISTABLE = ["stroke-width", "stroke-linecap", "stroke-linejoin"];

/** IconPark module names are PascalCase; the plugin addresses icons in kebab-case. */
function toKebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function stripHoistable(body) {
  let out = body;
  for (const attr of HOISTABLE) {
    const first = new RegExp(`${attr}="([^"]*)"`).exec(out);
    if (!first) continue;
    // Remove only the exact `attr="value"` pair seen, so a path that deliberately differs keeps it.
    out = out.split(` ${attr}="${first[1]}"`).join("");
  }
  return out;
}

function loadIcon(file) {
  // CommonJS: the package's `lib` build is what Node can require without an ESM loader.
  const mod = createRequire(import.meta.url)(path.join(ICONS_DIR, file));
  const icon = mod.default ?? mod;
  if (typeof icon !== "function") return null;

  const raw = String(icon(RENDER_PROPS));
  const match = /<svg([^>]*)>([\s\S]*)<\/svg>/.exec(raw);
  if (!match) return null;

  const viewBox = /viewBox="([^"]+)"/.exec(match[1])?.[1];
  if (!viewBox) return null;

  const body = stripHoistable(match[2]);
  if (!/C0/.test(body)) return null; // a drawing with no paint slot cannot be themed
  return { viewBox, body };
}

function main() {
  if (!existsSync(ICONS_DIR)) {
    console.error(`Missing ${ICONS_DIR}. Run: npm install`);
    process.exit(1);
  }

  const files = readdirSync(ICONS_DIR)
    .filter((f) => f.endsWith(".js") && /^[A-Z]/.test(f))
    .sort();

  const icons = {};
  const skipped = [];

  for (const file of files) {
    const name = path.basename(file, ".js");
    try {
      const rendered = loadIcon(file);
      if (rendered) icons[toKebab(name)] = rendered;
      else skipped.push(name);
    } catch (error) {
      skipped.push(`${name} (${error.message})`);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    source: "IconPark",
    author: "ByteDance",
    repo: "https://github.com/bytedance/iconpark",
    prefix: "icon-park",
    package: `@icon-park/svg@${PKG_VERSION}`,
    license: "Apache-2.0",
    themes: ["outline", "filled", "two-tone", "duotone"],
    stroke: RENDER_PROPS.strokeWidth,
    strokeLinecap: RENDER_PROPS.strokeLinecap,
    strokeLinejoin: RENDER_PROPS.strokeLinejoin,
    count: Object.keys(icons).length,
    icons,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload), "utf8");

  const bytes = Buffer.byteLength(JSON.stringify(payload));
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`  source:   ${payload.source} by ${payload.author} — ${payload.package} (${payload.license})`);
  console.log(`  prefix:   ${payload.prefix}:   e.g. ${payload.prefix}:folder-open`);
  console.log(`  icons:    ${payload.count}`);
  console.log(`  themes:   ${payload.themes.join(", ")}`);
  console.log(`  size:     ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  if (skipped.length > 0) console.log(`  skipped:  ${skipped.length} (${skipped.slice(0, 5).join(", ")})`);
}

main();