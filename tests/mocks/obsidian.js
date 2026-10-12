/**
 * Minimal stand-ins for the Obsidian classes these modules extend or construct.
 *
 * `Modal` matters most: several modules declare `class X extends Modal` at module scope, so a mock
 * without it makes importing those modules throw before any test runs. That is exactly the failure
 * the category-editor test was added to catch in the real plugin, so the mock has to support it.
 */

class Component {}

class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = { empty() {}, createEl: () => makeEl(), createDiv: () => makeEl() };
    this.titleEl = { setText() {} };
  }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

class SuggestModal {
  constructor(app) {
    this.app = app;
  }
  setPlaceholder() {}
  open() {}
  close() {}
}

class FuzzySuggestModal extends SuggestModal {}

class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this.commands = [];
    this.settingTabs = [];
    this.ribbons = [];
  }
  addCommand(c) {
    this.commands.push(c);
    return c;
  }
  addRibbonIcon(icon, title) {
    this.ribbons.push({ icon, title });
    return {};
  }
  addSettingTab(t) {
    this.settingTabs.push(t);
  }
  registerEvent() {
    return {};
  }
  async loadData() {
    return null;
  }
  async saveData() {}
}

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = makeEl();
  }
  display() {}
}

class Notice {
  constructor(message) {
    this.message = message;
  }
  setMessage(message) {
    this.message = message;
  }
  hide() {}
}

class Setting {
  constructor() {
    this.infoEl = makeEl();
    this.controlEl = makeEl();
    this.selectEl = { addEventListener() {} };
  }
  setName() { return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  setClass() { return this; }
  setWarning() { return this; }
  setCta() { return this; }
  setIcon() { return this; }
  setDynamicTooltip() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
  addExtra() { return this; }
}

class TAbstractFile {
  constructor(path) {
    this.path = path;
    this.name = path.split("/").pop();
  }
}

class TFile extends TAbstractFile {
  constructor(path) {
    super(path);
    this.extension = path.includes(".") ? path.split(".").pop() : "";
  }
}

class TFolder extends TAbstractFile {
  constructor(path) {
    super(path);
    this.children = [];
    this.isRoot = path === "/";
  }
}

function makeEl() {
  const el = {
    empty() {},
    createEl: () => makeEl(),
    createDiv: () => makeEl(),
    createSpan: () => makeEl(),
    setText() {},
    setAttribute() {},
    addEventListener() {},
    appendChild() {},
    style: {},
    dataset: {},
    innerHTML: "",
    titleEl: { setText() {} },
  };
  return el;
}

function setIcon() {}
function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

module.exports = {
  Component,
  Modal,
  SuggestModal,
  FuzzySuggestModal,
  Plugin,
  PluginSettingTab,
  Notice,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
  setIcon,
  normalizePath,
};