#!/usr/bin/env node
/**
 * Builds the local Material Design Icons set, in mXn naming.
 *
 * Reads `@mdi/svg` from `node_modules` (Apache-2.0, pinned by package-lock) and writes
 * `icons/mdi.json` — 7447 icons stored locally, so the plugin needs no network and does not depend
 * on whatever icon set Obsidian happens to ship.
 *
 * Why mdi and why mXn:
 *
 * - **mXn is the naming everybody already knows.** `mdi:folder-outline` is a name you can look up,
 *   copy from a website, or read out of another tool's config. The previous IconPark set used its
 *   own vocabulary, which meant every icon had to be discovered by browsing. Storing the mXn name
 *   means the plugin speaks the same language as the rest of the ecosystem.
 * - **The style dimension is the naming convention itself.** mdi ships filled and outline as paired
 *   names — `folder` and `folder-outline` — rather than as separate weights of one asset. So "style"
 *   is `name` vs `name-outline`, both present in the shipped file, with no colour remapping.
 *
 * mdi SVGs are pure fill path data with no colour slots, so the whole 7447-icon set costs about
 * two thirds of what the previous set did.
 *
 * Usage: node scripts/build-mdi.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SVG_DIR = path.join(ROOT, "node_modules", "@mdi", "svg", "svg");
const OUT_DIR = path.join(ROOT, "icons");
const OUT_FILE = path.join(OUT_DIR, "mdi.json");

const PKG_VERSION = "7.4.47";
const PREFIX = "mdi";

/** One icon: its mXn name (without the `mdi:` prefix) and the path data to draw it. */
function parse(file) {
  const name = path.basename(file, ".svg");
  const svg = readFileSync(path.join(SVG_DIR, file), "utf8");

  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (!viewBox) return null;

  // mdi is fill-only, so a stroke-based element means a file this parser does not understand.
  if (/<(stroke|circle|rect|line|polyline|polygon)\b/.test(svg)) {
    throw new Error(`unsupported shape element in ${name}`);
  }

  const d = [...svg.matchAll(/<path\s+[^>]*?\bd="([^"]*)"/g)].map((m) => m[1]).join(" ");
  if (d.length === 0) return null;

  return { name, viewBox, d };
}

function main() {
  if (!existsSync(SVG_DIR)) {
    console.error(`Missing ${SVG_DIR}. Run: npm install`);
    process.exit(1);
  }

  const files = readdirSync(SVG_DIR).filter((f) => f.endsWith(".svg")).sort();
  const icons = {};
  const skipped = [];

  for (const file of files) {
    try {
      const parsed = parse(file);
      if (parsed) icons[parsed.name] = { viewBox: parsed.viewBox, d: parsed.d };
      else skipped.push(file);
    } catch (error) {
      skipped.push(`${file} (${error.message})`);
    }
  }

  // Whether each icon has an outline twin decides if "outline" is a real choice or a silent
  // fallback, so the settings UI can tell the user instead of pretending.
  const outlineCount = Object.keys(icons).filter((n) => icons[n + "-outline"]).length;

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    source: "Material Design Icons",
    prefix: PREFIX,
    package: `@mdi/svg@${PKG_VERSION}`,
    license: "Apache-2.0",
    styles: ["filled", "outline"],
    count: Object.keys(icons).length,
    outlineCount,
    icons,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload), "utf8");

  const bytes = Buffer.byteLength(JSON.stringify(payload));
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`  source:    ${payload.package} (${payload.license})`);
  console.log(`  prefix:    ${PREFIX}:  e.g. ${PREFIX}:folder, ${PREFIX}:folder-outline`);
  console.log(`  icons:     ${payload.count} (${outlineCount} with an outline twin)`);
  console.log(`  size:      ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  if (skipped.length > 0) console.log(`  skipped:   ${skipped.length} (${skipped.slice(0, 5).join(", ")})`);
}

main();