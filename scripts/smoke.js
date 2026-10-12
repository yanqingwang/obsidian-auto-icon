/**
 * Smoke-loads the real built bundle against a stubbed `obsidian` module.
 *
 * A plugin that throws at import time, or that fails to register its commands, is broken in
 * Obsidian — and neither `tsc` nor jest would catch it, because jest tests the source modules while
 * Obsidian loads the bundle. `obsidian` is stubbed so this runs in plain Node.
 *
 * The icon set is served from disk the way the vault adapter would, so the full path — load bundle,
 * register commands, read `icons/iconpark.json`, render a real icon — is exercised.
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
  registerEvent() {}
  async loadData() { return null; }
  async saveData() {}
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty(){}, createEl(){}, createDiv(){}, style:{} }; } }
class Notice { constructor(m) { this.message = m; } setMessage(m) { this.message = m; } hide() {} }
class Modal { constructor(app) { this.app = app; this.contentEl = { empty(){} }; this.titleEl = { setText(){} }; } open(){} close(){} }
class SuggestModal { constructor(app) { this.app = app; } setPlaceholder(){} open(){} close(){} }
class Setting {
  constructor() {
    this.infoEl = { createSpan: () => ({ empty(){}, setText(){}, appendChild(){} }) };
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
class FuzzySuggestModal { constructor(app) { this.app = app; } setPlaceholder(){} open(){} close(){} }
function normalizePath(p) { return p.replace(/\\\\/g, "/"); }
module.exports = { Plugin, PluginSettingTab, Notice, Modal, SuggestModal, Setting, TFile, TFolder, TAbstractFile, FuzzySuggestModal, normalizePath, Component };
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

const EXPECTED_COMMANDS = ["assign-current", "scan-vault", "scan-folder", "restyle", "clear-current"];

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
      modify: async () => {},
    },
    workspace: { getActiveFile: () => null },
    fileManager: { processFrontMatter: async () => {} },
    metadataCache: { getFileCache: () => null },
  };

  const plugin = new PluginClass(app, { id: "auto-icon", version: "0.1.0", dir: "." });
  await plugin.onload();

  const ids = plugin.commands.map((c) => c.id);
  const problems = [];

  const missing = EXPECTED_COMMANDS.filter((id) => !ids.includes(id));
  if (missing.length) problems.push(`missing commands: ${missing.join(", ")}`);
  if (plugin.settings === undefined) problems.push("settings not loaded");
  if (plugin.settingTabs.length !== 1) problems.push("settings tab not registered");
  if (plugin.ribbons.length !== 1) problems.push("ribbon icon not registered");

  // The 32-category cap is a stated requirement.
  if (plugin.settings.categories.length !== 32) {
    problems.push(`expected 32 default categories, got ${plugin.settings.categories.length}`);
  }
  if (plugin.remainingCategorySlots !== 0) problems.push("category slots miscomputed");
  if (plugin.settings.ai.enabled) problems.push("AI must be off by default");
  if (!plugin.settings.previewBeforeWrite) problems.push("preview must be on by default");
  if (plugin.settings.iconTheme !== "outline") problems.push("default theme must be outline");

  // The icon set must load from disk and every default category must resolve through it.
  const set = await plugin.loadIconSet();
  if (set.license !== "Apache-2.0") problems.push(`unexpected icon licence: ${set.license}`);
  const unresolved = plugin.settings.categories.filter((c) => !set.icons[c.icon]);
  if (unresolved.length) {
    problems.push(`categories with no icon in the shipped set: ${unresolved.map((c) => c.id).join(", ")}`);
  }

  // A scan over an empty vault must be a clean no-op, not a throw.
  await plugin.scanScope("");

  console.log(
    JSON.stringify(
      {
        commands: ids,
        ribbon: plugin.ribbons.length,
        settingsTab: plugin.settingTabs.length,
        categories: plugin.settings.categories.length,
        iconSet: `${set.source} ${set.package} ${set.license} · ${set.count} icons · ${set.themes.join("/")}`,
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