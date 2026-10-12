import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { AiClassifier } from "./ai";
import { cloneCategories } from "./categories";
import { extractSignals, RuleClassifier, type NoteClassifier } from "./classifier";
// Aliased: the plugin exposes a `loadIconSet()` method too, and an unaliased import of the same
// name resolves back to the method — which is infinite recursion, not a subtle bug.
import {
  loadIconSet as readIconSetFromDisk,
  mxnName,
  setIconSetLoader,
  shapeFor,
  type IconSetMeta,
} from "./iconset";
import { IconPickerModal } from "./IconPickerModal";
import { detectIcon, stripIcon, type IconStyle } from "./placement";
import { buildPlan, type ScanPlan } from "./planner";
import { PreviewModal } from "./previewModal";
import { IconSettingsTab } from "./SettingsTab";
import {
  ACTIVATION_HINT,
  withDefaults,
  type AutoIconSettings,
  type AutoIconHost,
} from "./settings";
import { pruneMissing, type IconMap } from "./store";
import { applyStylesheet, buildCss, removeStylesheet, wrapCss } from "./treeIcons";

/**
 * Auto Icon — give each note an icon in the file explorer, chosen from its content.
 *
 * **Notes are never modified.** Every assignment lives in this plugin's `data.json` and is drawn by
 * a generated stylesheet. Nothing is written into a note, nothing is renamed, and removing the
 * plugin leaves the vault exactly as it was.
 *
 * The run is linear and inspectable — resolve scope → read → classify → plan → show → store → redraw
 * — and no assignment is saved until the user has seen which notes would change.
 */
export default class AutoIconPlugin extends Plugin implements AutoIconHost {
  settings: AutoIconSettings = withDefaults(null);

  /** Note path -> icon. The entire persisted state of the plugin. */
  icons: IconMap = {};

  /** Loaded icon set; the settings tab needs it to draw category thumbnails. */
  set: IconSetMeta | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    if (this.settings.categories.length === 0) {
      this.settings.categories = cloneCategories();
      await this.saveSettings();
    }
    this.icons = (this.settings.icons ?? {}) as IconMap;

    // The loader must read the file itself, not call `loadIconSet()`: that method defers to
    // `loadIconSet()` from the icon-set module, which invokes this loader — so pointing the loader
    // back at the method is a cycle, not a convenience.
    setIconSetLoader(async () => {
      const file = normalizePath(`${this.manifest.dir ?? ".obsidian/plugins/auto-icon"}/icons/mdi.json`);
      const text = await this.app.vault.adapter.read(file);
      const set = JSON.parse(text) as IconSetMeta;
      this.set = set;
      return set;
    });

    this.addSettingTab(new IconSettingsTab(this.app, this));
    this.addRibbonIcon("sparkles", "Auto Icon：为当前笔记分配图标", () => {
      void this.scanCurrentNote();
    });

    this.addCommand({
      id: "assign-current",
      name: "给当前笔记配图标",
      callback: () => void this.scanCurrentNote(),
    });
    this.addCommand({
      id: "scan-vault",
      name: "给全部笔记配图标",
      callback: () => void this.scanScope(this.settings.scopeFolder),
    });
    this.addCommand({
      id: "scan-folder",
      name: "给当前文件夹配图标",
      callback: () => void this.scanCurrentFolder(),
    });
    this.addCommand({
      id: "reassign-all",
      name: "重新分配（覆盖已有图标）",
      callback: () => void this.scanScope(this.settings.scopeFolder, { force: true }),
    });
    this.addCommand({
      id: "pick-icon",
      name: "手动设置当前笔记图标",
      callback: () => void this.pickIconForCurrentNote(),
    });
    this.addCommand({
      id: "clear-current",
      name: "清除当前笔记的图标",
      callback: () => void this.clearCurrentNoteIcon(),
    });
    this.addCommand({
      id: "clear-all",
      name: "清除全部图标",
      callback: () => void this.clearAllIcons(),
    });
    this.addCommand({
      id: "cleanup-legacy",
      name: "清理正文里的旧图标行",
      callback: () => void this.cleanupLegacyLines(),
    });

    // Assignments can only be drawn once the icon set is readable, and the file explorer may not
    // exist yet on first load, so redraw on layout changes as well.
    void this.refreshIcons();
    this.registerEvent(this.app.workspace.on("layout-change", () => void this.refreshIcons()));

    this.registerFileMenu();

    if (!this.settings.activationHintDismissed) this.showActivationHint();
  }

  /**
   * "Assign an icon" on right-clicking a note in the file explorer.
   *
   * A feature that lives in the file tree has to be reachable from the file tree. Scanning is the
   * bulk entry point; this is the per-note one, and it is the only way to act on a single file
   * without pointing the scope at the folder it happens to sit in.
   */
  private registerFileMenu(): void {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) =>
          item
            .setTitle(this.icons[file.path] ? "重新配图标" : "配图标")
            .setIcon("sparkles")
            .onClick(() => void this.assignOne(file))
        );
        if (this.icons[file.path]) {
          menu.addItem((item) =>
            item
              .setTitle("移除图标")
              .setIcon("trash-2")
              .onClick(async () => {
                delete this.icons[file.path];
                await this.saveSettings();
                await this.refreshIcons();
              })
          );
        }
      })
    );
  }

  /** Assign a single note immediately, bypassing the scope scan. */
  async assignOne(file: TFile): Promise<void> {
    await this.runScan([file], file.path, { force: true });
  }

  onunload(): void {
    // Never leave our stylesheet behind in the user's Obsidian.
    try {
      removeStylesheet(document);
    } catch {
      /* document is unavailable during teardown in some hosts */
    }
  }

  /* ---------------------------------------------------------------- *
   * Settings and storage
   * ---------------------------------------------------------------- */

  async loadSettings(): Promise<void> {
    this.settings = withDefaults(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    this.settings.icons = this.icons;
    await this.saveData(this.settings);
  }

  async loadIconSet(): Promise<IconSetMeta> {
    const set = await readIconSetFromDisk();
    this.set = set;
    return set;
  }

  /** Cached set, loading it if a caller needs it before the first scan. */
  private async requireSet(): Promise<IconSetMeta> {
    return this.set ?? this.loadIconSet();
  }

  get iconSetMeta(): IconSetMeta | null {
    return this.set;
  }

  showActivationHint(): void {
    new Notice(ACTIVATION_HINT, 12000);
  }

  /* ---------------------------------------------------------------- *
   * Drawing
   * ---------------------------------------------------------------- */

  /**
   * Rebuild the stylesheet from the stored assignments.
   *
   * Purely cosmetic, so a failure here is reported and swallowed rather than allowed to interrupt
   * whatever triggered it — the notes are untouched either way.
   */
  async refreshIcons(): Promise<void> {
    try {
      const set = await this.requireSet();
      const { css, skipped } = buildCss(this.icons, {
        shapeFor: (icon, style) => shapeFor(set, icon, style as IconStyle)?.shape ?? null,
      });
      applyStylesheet(document, wrapCss(css));
      if (skipped.length > 0) {
        console.warn(`[auto-icon] ${skipped.length} note(s) have an icon missing from the set`);
      }
    } catch (error) {
      console.warn("[auto-icon] could not draw file-explorer icons", error);
    }
  }

  /* ---------------------------------------------------------------- *
   * Scanning
   * ---------------------------------------------------------------- */

  async scanCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Auto Icon：没有打开的笔记。");
      return;
    }
    await this.runScan([file], `当前笔记（${file.path}）`);
  }

  async scanCurrentFolder(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Auto Icon：没有打开的笔记。");
      return;
    }
    const parent = file.parent?.path;
    if (!parent) {
      new Notice("Auto Icon：当前笔记不在任何文件夹里。");
      return;
    }
    await this.scanScope(parent);
  }

  /** The settings-header button: scan whatever scope is configured. */
  async startScan(): Promise<void> {
    await this.scanScope(this.settings.scopeFolder);
  }

  async scanScope(scopeFolder: string, options: { force?: boolean } = {}): Promise<void> {
    const files = this.resolveScope(scopeFolder);
    if (files.length === 0) {
      new Notice("Auto Icon：范围内没有 Markdown 文件。");
      return;
    }
    const label =
      scopeFolder.trim().length === 0
        ? `全部笔记（${files.length} 个）`
        : `「${scopeFolder.trim()}」（${files.length} 个）`;
    await this.runScan(files, label, options);
  }

  private resolveScope(scopeFolder: string): TFile[] {
    const folder = scopeFolder.trim().replace(/^\/+|\/+$/g, "");
    const hidden = (p: string): boolean => p.split("/").some((s) => s.startsWith("."));

    if (folder.length === 0) {
      return this.app.vault.getMarkdownFiles().filter((f) => !hidden(f.path));
    }

    const target = this.app.vault.getAbstractFileByPath(folder);
    if (target instanceof TFile) return [target];
    const children = (target as unknown as { children?: unknown[] } | null)?.children;
    if (!children) {
      new Notice(`Auto Icon：找不到文件夹 "${folder}"。清空这一栏即可扫描整个 vault。`, 8000);
      return [];
    }

    const out: TFile[] = [];
    const walk = (node: { children: unknown[] }): void => {
      for (const child of node.children as Array<TFile | { children: unknown[]; path: string }>) {
        if (child instanceof TFile) {
          if (child.extension === "md" && !hidden(child.path)) out.push(child);
        } else if (child.path && !hidden(child.path)) {
          if (this.settings.includeSubfolders) walk(child);
        }
      }
    };
    walk(target as unknown as { children: unknown[] });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async runScan(
    files: TFile[],
    description: string,
    options: { force?: boolean } = {}
  ): Promise<void> {
    const warnings: string[] = [];
    const seen = new Set<string>();
    const warn = (m: string): void => {
      if (!seen.has(m)) {
        seen.add(m);
        warnings.push(m);
      }
    };

    const classifier = this.buildClassifier(warn);
    const set = await this.requireSet();
    const style = this.settings.iconStyle as import("./placement").IconStyle;
    const size = this.settings.iconSize;

    const inputs = [];
    let matched = 0;

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const raw = await this.app.vault.cachedRead(file);
      const { body, frontmatter } = readNote(raw);

      const signals = extractSignals({ path: file.path, frontmatter, body });
      const classification = await classifier.classify(signals, this.settings.categories);
      const category = this.settings.categories.find((c) => c.id === classification.categoryId);
      if (category) matched += 1;

      inputs.push({
        path: file.path,
        // An icon the previous version wrote into the note counts as what the note already has, so
        // those notes are not re-classified into a different icon behind the user's back.
        existing: this.icons[file.path] ?? fromWrittenLine(detectIcon(body)),
        classification,
        categoryId: category?.id ?? null,
        icon: category?.icon ?? null,
        style,
        size,
      });
    }

    const plan: ScanPlan = buildPlan(inputs, {
      current: this.icons,
      overwriteExisting: options.force === true || this.settings.overwriteExisting,
    });

    if (warnings.length > 0) new Notice(warnings.join("\n"), 10000);
    if (plan.changes.length === 0) {
      new Notice(`Auto Icon：没有需要分配的图标（处理了 ${files.length} 个笔记）。`);
      return;
    }

    const proceed = (): void => void this.commit(plan);
    if (this.settings.previewBeforeWrite) {
      new PreviewModal(
        this.app,
        {
          plan,
          scopeDescription: description,
          matched,
          considered: files.length,
          aiEnabled: this.settings.ai.enabled,
          iconSet: set,
          iconStyle: this.settings.iconStyle,
        },
        proceed
      ).open();
    } else {
      proceed();
    }
  }

  private async commit(plan: ScanPlan): Promise<void> {
    for (const change of plan.changes) {
      this.icons[change.path] = {
        categoryId: change.categoryId,
        icon: change.after,
        style: change.style,
        size: change.size,
      };
    }
    await this.saveSettings();
    await this.refreshIcons();
    new Notice(`Auto Icon：已给 ${plan.changes.length} 个笔记配好图标，文件没有被修改。`, 8000);
  }

  /* ---------------------------------------------------------------- *
   * Manual commands
   * ---------------------------------------------------------------- */

  async pickIconForCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Auto Icon：没有打开的笔记。");
      return;
    }
    const set = await this.requireSet();
    const chosen = await new Promise<string | null>((resolve) => {
      const modal = new IconPickerModal(this.app, set, this.settings.iconStyle, (value) => resolve(value));
      modal.open();
    });
    if (!chosen) return;

    this.icons[file.path] = {
      categoryId: "custom",
      icon: chosen,
      style: this.settings.iconStyle,
      size: this.settings.iconSize,
    };
    await this.saveSettings();
    await this.refreshIcons();
    new Notice(`Auto Icon：已为 ${file.path} 设置 ${mxnName(set, chosen)}。`);
  }

  async pickIconForCategory(categoryId: string): Promise<void> {
    const category = this.settings.categories.find((c) => c.id === categoryId);
    if (!category) return;
    const set = await this.requireSet();

    const chosen = await new Promise<string | null>((resolve) => {
      new IconPickerModal(this.app, set, this.settings.iconStyle, (value) => resolve(value)).open();
    });
    if (!chosen || chosen === category.icon) return;

    category.icon = chosen;
    await this.saveSettings();
  }

  async clearCurrentNoteIcon(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Auto Icon：没有打开的笔记。");
      return;
    }
    if (!this.icons[file.path]) {
      new Notice("Auto Icon：当前笔记没有图标。");
      return;
    }
    delete this.icons[file.path];
    await this.saveSettings();
    await this.refreshIcons();
    new Notice(`Auto Icon：已移除 ${file.path} 的图标。`);
  }

  private async clearAllIcons(): Promise<void> {
    const count = Object.keys(this.icons).length;
    if (count === 0) {
      new Notice("Auto Icon：当前没有任何图标。");
      return;
    }
    this.icons = {};
    await this.saveSettings();
    await this.refreshIcons();
    new Notice(`Auto Icon：已清除 ${count} 个图标。`);
  }

  /**
   * Remove the SVG line that earlier versions wrote into note bodies.
   *
   * Offered as an explicit command rather than done automatically: it modifies files, and this
   * plugin's whole premise is that it does not.
   */
  private async cleanupLegacyLines(): Promise<void> {
    const candidates: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (detectIcon(await this.app.vault.read(file))) candidates.push(file);
    }

    if (candidates.length === 0) {
      new Notice("Auto Icon：没有找到旧版本写入的图标行。");
      return;
    }

    let cleaned = 0;
    const failures: string[] = [];
    for (const file of candidates) {
      try {
        const raw = await this.app.vault.read(file);
        const { frontmatterText, body } = readNote(raw);
        await this.app.vault.modify(file, frontmatterText + stripIcon(body));
        cleaned += 1;
      } catch (error) {
        failures.push(`${file.path} (${String(error)})`);
      }
    }

    new Notice(
      `Auto Icon：已清理 ${cleaned} 个笔记里的旧图标行${failures.length ? `，${failures.length} 个失败` : ""}。`,
      failures.length ? 10000 : 8000
    );
  }

  /**
   * Local rules by default; the AI classifier wraps them so any failure degrades back rather than
   * leaving a note unclassified.
   */
  private buildClassifier(onWarning: (message: string) => void): NoteClassifier {
    const rules = new RuleClassifier({ minScore: this.settings.minScore, weights: this.settings.weights });
    if (!this.settings.ai.enabled) return rules;
    return new AiClassifier(this.settings.ai, rules, undefined, onWarning);
  }
}

/* ------------------------------------------------------------------ *
 * Note reading
 *
 * Local rather than via Obsidian's helpers so the split is testable in plain Node, and so the
 * frontmatter text can be preserved byte for byte.
 * ------------------------------------------------------------------ */

export function readNote(raw: string): {
  frontmatterText: string;
  body: string;
  frontmatter: Record<string, unknown>;
} {
  const match = /^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?)/.exec(raw);
  const frontmatterText = match ? match[1] : "";
  const body = match ? raw.slice(match[1].length) : raw;

  const frontmatter: Record<string, unknown> = {};
  let key: string | null = null;
  for (const line of frontmatterText.split(/\r?\n/).slice(1, -1)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      const existing = frontmatter[key];
      frontmatter[key] = Array.isArray(existing) ? [...(existing as string[]), item[1].trim()] : [item[1].trim()];
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      frontmatter[key] = kv[2].trim();
    }
  }
  return { frontmatterText, body, frontmatter };
}

/** An icon left in a note body by an earlier version, treated as an existing assignment. */
function fromWrittenLine(detected: ReturnType<typeof detectIcon>): {
  categoryId: string;
  icon: string;
  style: string;
  size: number;
} | null {
  return detected ? { categoryId: "legacy", ...detected } : null;
}