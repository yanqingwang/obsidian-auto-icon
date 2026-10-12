/**
 * Smoke-loads the real built bundle against a stubbed `obsidian` module.
 *
 * A plugin that throws at import time, or that fails to register its commands, is broken in
 * Obsidian — and neither `tsc` nor jest would catch it, because jest tests the source modules
 * while Obsidian loads the bundle. `obsidian` here is a stub, so this runs in plain Node.
 *
 * Run with: npm run smoke
 */
const Module = require("module");
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
class Notice { constructor(m) { this.message = m; } setMessage(m) { this.message = m; } }
class Modal { constructor(app) { this.app = app; this.contentEl = { empty(){} }; this.titleEl = { setText(){} }; } open(){} close(){} }
class SuggestModal { constructor(app) { this.app = app; } setPlaceholder(){} open(){} close(){} }
class Setting {
  constructor() {
    this.infoEl = { createSpan: () => ({ empty(){}, setText(){} }) };
    this.selectEl = { addEventListener(){} };
  }
  setName(){return this} setDesc(){return this} setHeading(){return this} setClass(){return this}
  setWarning(){return this} setDynamicTooltip(){return this}
  addText(){return this} addToggle(){return this} addDropdown(){return this} addButton(){return this} addExtra(){return this}
}
class TAbstractFile { constructor(p) { this.path = p; } }
class TFile extends TAbstractFile { constructor(p) { super(p); this.extension = (p.split(".").pop() || ""); } }
class TFolder extends TAbstractFile { constructor(p) { super(p); this.children = []; this.isRoot = p === "/"; } }
class FuzzySuggestModal { constructor(app) { this.app = app; } setPlaceholder(){} open(){} close(){} }
function getIconIds() { return ["inbox", "folder-kanban", "list-checks", "scale", "users", "file-chart-column", "flask-conical", "book-open", "wand-sparkles", "palette", "code", "bug", "flask-round", "rocket", "server", "file-text", "workflow", "gauge", "copy", "archive", "wallet", "file-pen", "handshake", "truck", "user-plus", "messages-square", "graduation-cap", "trending-up", "triangle-alert", "lightbulb", "key-round", "bookmark"]; }
function setIcon() {}
module.exports = { Plugin, PluginSettingTab, Notice, Modal, SuggestModal, Setting, TFile, TFolder, TAbstractFile, FuzzySuggestModal, getIconIds, setIcon, Component };
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

const EXPECTED_COMMANDS = [
  "assign-current",
  "scan-vault",
  "scan-folder",
  "reapply-all",
  "pick-icon",
  "clear-current",
];

(async () => {
  const bundle = path.resolve(process.argv[2] ?? "main.js");
  const mod = require(bundle);
  const PluginClass = mod.default ?? mod;

  const app = {
    vault: {
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      getRoot: () => ({ children: [] }),
    },
    workspace: { getActiveFile: () => null },
    fileManager: { processFrontMatter: async () => {} },
    metadataCache: { getFileCache: () => null },
  };

  const plugin = new PluginClass(app, { id: "auto-icon", version: "0.1.0" });
  await plugin.onload();

  const ids = plugin.commands.map((c) => c.id);
  const problems = [];

  const missing = EXPECTED_COMMANDS.filter((id) => !ids.includes(id));
  if (missing.length) problems.push(`missing commands: ${missing.join(", ")}`);
  if (plugin.settingTabs.length !== 1) problems.push("settings tab not registered");
  if (plugin.ribbons.length !== 1) problems.push("ribbon icon not registered");

  // The 32-category cap is a stated requirement; check the shipped defaults honour it.
  if (plugin.settings.categories.length !== 32) {
    problems.push(`expected 32 default categories, got ${plugin.settings.categories.length}`);
  }
  if (plugin.remainingCategorySlots !== 0) problems.push("category slots miscomputed");
  if (plugin.settings.ai.enabled) problems.push("AI must be off by default");
  if (!plugin.settings.previewBeforeWrite) problems.push("preview must be on by default");

  // A scan over an empty vault must be a clean no-op, not a throw.
  await plugin.scanScope("");

  console.log(
    JSON.stringify(
      {
        commands: ids,
        ribbon: plugin.ribbons.length,
        settingsTab: plugin.settingTabs.length,
        categories: plugin.settings.categories.length,
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