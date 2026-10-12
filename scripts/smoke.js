/**
 * Smoke-loads the real built bundle against a stubbed `obsidian` module.
 *
 * A plugin that throws at import time, or fails to register its commands, is broken in Obsidian —
 * and neither `tsc` nor jest catches it, because jest tests the source while Obsidian loads the
 * bundle. `obsidian` is stubbed so this runs in plain Node.
 *
 * The stub `document` is a few lines rather than jsdom, because jsdom is ESM-only and this runs as
 * CommonJS. It exercises the real path end to end: load the bundle, register commands, read
 * `icons/mdi.json`, assign an icon, and generate the stylesheet that draws it.
 *
 * Run with: npm run smoke
 */
const Module = require("module");
const fs = require("fs");
const path = require("path");

const stub = `
class Component {}
class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; this.commands = []; this.settingTabs = []; this.ribbons = []; }
  addCommand(c) { this.commands.push(c); return c; }
  addRibbonIcon(i, t, cb) { this.ribbons.push({ i, t, cb }); return {}; }
  addSettingTab(t) { this.settingTabs.push(t); }
  registerEvent() { return {}; }
  async loadData() { return null; }
  async saveData() {}
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty(){}, createEl(){}, createDiv(){}, style:{} }; } }
class Notice { constructor(m) { this.message = m; } setMessage(m) { this.message = m; } hide() {} }
class Modal { constructor(app) { this.app = app; this.contentEl = { empty(){} }; this.titleEl = { setText(){} }; } open(){} close(){} }
class FuzzySuggestModal { constructor(app) { this.app = app; } setPlaceholder(){} open(){} close(){} }
class Setting {
  constructor() {
    this.infoEl = { createSpan: () => ({ empty(){}, setText(){}, appendChild(){}, innerHTML: "" }) };
    this.controlEl = { createEl: () => ({ createEl: () => ({ createSpan: () => ({}) }) }) };
    this.selectEl = { addEventListener(){} };
  }
  setName(){return this} setDesc(){return this} setHeading(){return this} setClass(){return this}
  setWarning(){return this} setDynamicTooltip(){return this} setIcon(){return this}
  addText(){return this} addToggle(){return this} addDropdown(){return this} addButton(){return this} addExtra(){return this}
}
class TAbstractFile { constructor(p) { this.path = p; } }
class TFile extends TAbstractFile { constructor(p) { super(p); this.extension = (p.split(".").pop() || ""); } }
class TFolder extends TAbstractFile { constructor(p) { super(p); this.children = []; this.isRoot = p === "/"; } }
function setIcon() {}
function normalizePath(p) { return p.replace(/\\\\/g, "/"); }
module.exports = { Plugin, PluginSettingTab, Notice, Modal, FuzzySuggestModal, Setting, TFile, TFolder, TAbstractFile, setIcon, normalizePath, Component };
`;

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    const stubModule = { exports: {} };
    new Function("module", "exports", stub)(stubModule, stubModule.exports);
    return stubModule.exports;
  }
  return origLoad.call(this, request, parent, isMain);
};

/** Minimal document stand-in: the plugin only creates, updates and removes one style element. */
function fakeDocument() {
  const nodes = new Map();
  return {
    head: { appendChild: (n) => nodes.set(n.id, n) },
    createElement: () => {
      const node = { id: "", textContent: "" };
      node.remove = () => nodes.delete(node.id);
      return node;
    },
    getElementById: (id) => nodes.get(id) ?? null,
  };
}

globalThis.document = fakeDocument();

const EXPECTED_COMMANDS = [
  "assign-current",
  "scan-vault",
  "scan-folder",
  "reassign-all",
  "pick-icon",
  "clear-current",
  "clear-all",
  "cleanup-legacy",
];

(async () => {
  const bundle = path.resolve(process.argv[2] ?? "main.js");
  const mod = require(bundle);
  const PluginClass = mod.default ?? mod;

  const PLUGIN_DIR = path.resolve(__dirname, "..");
  const app = {
    vault: {
      adapter: {
        read: async (p) => fs.readFileSync(path.join(PLUGIN_DIR, p), "utf8"),
        exists: async (p) => fs.existsSync(path.join(PLUGIN_DIR, p)),
        write: async () => {},
        mkdir: async () => {},
      },
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      getRoot: () => ({ children: [] }),
      read: async () => "",
      cachedRead: async () => "",
      modify: async () => {},
    },
    workspace: {
      getActiveFile: () => null,
      on: () => {},
    },
    fileManager: { processFrontMatter: async () => {} },
    metadataCache: { getFileCache: () => null },
  };

  const plugin = new PluginClass(app, { id: "auto-icon", version: "0.1.0", dir: "." });
  await plugin.onload();

  const problems = [];
  const ids = plugin.commands.map((c) => c.id);
  const missing = EXPECTED_COMMANDS.filter((id) => !ids.includes(id));
  if (missing.length) problems.push(`missing commands: ${missing.join(", ")}`);
  if (plugin.settingTabs.length !== 1) problems.push("settings tab not registered");
  if (plugin.ribbons.length !== 1) problems.push("ribbon icon not registered");

  // Stated requirements.
  if (plugin.settings.categories.length !== 32) {
    problems.push(`expected 32 default categories, got ${plugin.settings.categories.length}`);
  }
  // 32 is the default, not a cap: adding more must be possible.
  plugin.settings.categories.push({ id: "extra", name: "额外", description: "", icon: "star", keywords: [] });
  if (plugin.settings.categories.length !== 33) problems.push("could not add a 33rd category");
  plugin.settings.categories.pop();
  if (plugin.settings.ai.enabled) problems.push("AI must be off by default");
  if (!plugin.settings.previewBeforeWrite) problems.push("preview must be on by default");

  // The icon set must load from disk and every default category must resolve through it.
  const set = await plugin.loadIconSet();
  if (set.license !== "Apache-2.0") problems.push(`unexpected icon licence: ${set.license}`);
  if (set.prefix !== "mdi") problems.push(`expected mXn mdi prefix, got ${set.prefix}`);
  const unresolved = plugin.settings.categories.filter((c) => !set.icons[c.icon]);
  if (unresolved.length) {
    problems.push(`categories missing from the shipped set: ${unresolved.map((c) => c.id).join(", ")}`);
  }

  // A real assignment must produce a real stylesheet rule.
  plugin.icons["notes/会议/周会.md"] = { categoryId: "meeting", icon: "account-group", style: "outline", size: 16 };
  await plugin.refreshIcons();
  const css = document.getElementById("auto-icon-tree")?.textContent ?? "";
  if (!css.includes('data-path="notes/会议/周会.md"')) problems.push("stylesheet missing the note rule");
  if (!css.includes("mdi") && !css.includes("data:image/svg+xml")) problems.push("stylesheet has no icon data");

  // Clean teardown must remove the stylesheet from the user's Obsidian.
  plugin.onunload();
  if (document.getElementById("auto-icon-tree")) problems.push("stylesheet not removed on unload");

  // An empty-vault scan must be a clean no-op, not a throw.
  await plugin.scanScope("");

  console.log(
    JSON.stringify(
      {
        commands: ids.length,
        categories: plugin.settings.categories.length,
        iconSet: `${set.source} ${set.prefix}: ${set.package} (${set.license}) · ${set.count} icons`,
        stylesheetRule: css.length > 0,
        problems,
      },
      null,
      2
    )
  );
  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.error("SMOKE LOAD FAILED:", e);
  process.exit(1);
});