import { Notice, Plugin, SuggestModal, TFile, getIconIds, type App } from "obsidian";
import { AiClassifier } from "./ai";
import { assertCategoryLimit, cloneCategories, CATEGORY_LIMIT } from "./categories";
import {
  extractSignals,
  RuleClassifier,
  type Classification,
  type NoteClassifier,
} from "./classifier";
import { buildPlan, type IconChange, type ScanInput } from "./planner";
import { IconPreviewModal } from "./previewModal";
import { resolveIcon, type SourceContext } from "./sources";
import { IconSettingsTab } from "./SettingsTab";
import {
  ACTIVATION_HINT,
  FRONTMATTER_KEY,
  withDefaults,
  type AutoIconSettings,
} from "./settings";

/**
 * Auto Icon — assign an icon to each note based on its content.
 *
 * Deliberately standalone: the default classifier is local rules, so the plugin works offline with
 * no key and no network. AI is an opt-in layer behind the same interface, and it degrades back to
 * rules whenever it fails.
 *
 * The run is linear and inspectable — resolve scope → extract signals → classify → plan → show →
 * write — and nothing is written until the user has seen what would change.
 */
export default class AutoIconPlugin extends Plugin {
  settings: AutoIconSettings = withDefaults(null);

  async onload(): Promise<void> {
    await this.loadSettings();
    if (this.settings.categories.length === 0) {
      this.settings.categories = cloneCategories();
      await this.saveSettings();
    }

    this.addSettingTab(new IconSettingsTab(this.app, this));

    this.addRibbonIcon("wand-sparkles", "Auto Icon：为当前笔记分配图标", () => {
      void this.scanCurrentNote();
    });

    this.addCommand({
      id: "assign-current",
      name: "为当前笔记分配图标",
      callback: () => void this.scanCurrentNote(),
    });

    this.addCommand({
      id: "scan-vault",
      name: "扫描整个 vault 并分配图标",
      callback: () => void this.scanScope(this.settings.scopeFolder),
    });

    this.addCommand({
      id: "scan-folder",
      name: "扫描当前文件夹并分配图标",
      callback: () => void this.scanCurrentFolder(),
    });

    this.addCommand({
      id: "reapply-all",
      name: "重新扫描并覆盖已有图标",
      callback: () => void this.scanScope(this.settings.scopeFolder, { force: true }),
    });

    this.addCommand({
      id: "pick-icon",
      name: "手动为当前笔记设置图标",
      callback: () => void this.pickIconForCurrentNote(),
    });

    this.addCommand({
      id: "clear-current",
      name: "清除当前笔记的图标",
      callback: () => void this.clearCurrentNoteIcon(),
    });

    if (!this.settings.activationHintDismissed) {
      this.showActivationHint();
    }
  }

  /* ---------------------------------------------------------------- *
   * Settings
   * ---------------------------------------------------------------- */

  async loadSettings(): Promise<void> {
    this.settings = withDefaults(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    assertCategoryLimit(this.settings.categories);
    await this.saveData(this.settings);
  }

  /** Remaining categories the 32 cap allows, for the settings UI. */
  get remainingCategorySlots(): number {
    return CATEGORY_LIMIT - this.settings.categories.length;
  }

  showActivationHint(): void {
    new Notice(ACTIVATION_HINT, 12000);
  }

  /* ---------------------------------------------------------------- *
   * Classification plumbing
   * ---------------------------------------------------------------- */

  /** Lucide names this Obsidian build actually provides — queried once per load. */
  private lucideIds: ReadonlySet<string> = new Set<string>();

  private sourceContext(): SourceContext {
    return { lucideIds: this.lucideIds, userSources: this.settings.userSources };
  }

  private buildClassifier(onWarning?: (m: string) => void): NoteClassifier {
    const rules = new RuleClassifier({
      minScore: this.settings.minScore,
      weights: this.settings.weights,
    });
    if (!this.settings.ai.enabled) return rules;
    return new AiClassifier(this.settings.ai, rules, undefined, onWarning);
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

  async scanScope(scopeFolder: string, options: { force?: boolean } = {}): Promise<void> {
    const files = this.resolveScope(scopeFolder);
    if (files.length === 0) {
      new Notice("Auto Icon：范围内没有 Markdown 文件。");
      return;
    }
    const label =
      scopeFolder.trim().length === 0
        ? `整个 vault（${files.length} 个笔记）`
        : `"${scopeFolder.trim()}"（${files.length} 个笔记）`;
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
    if (!(target as unknown as { children?: unknown[] })?.children) {
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

  private async runScan(files: TFile[], description: string, options: { force?: boolean } = {}): Promise<void> {
    // Obsidian's own icon set is the one source that depends on the host build; resolve it lazily
    // so a headless or unusual host degrades to emoji fallbacks rather than throwing.
    try {
      if (this.lucideIds.size === 0) this.lucideIds = new Set(getIconIds());
    } catch (error) {
      console.warn("[auto-icon] getIconIds() unavailable, falling back to emoji", error);
      this.lucideIds = new Set();
    }

    const warnings: string[] = [];
    const seen = new Set<string>();
    const warn = (m: string): void => {
      if (seen.has(m)) return;
      seen.add(m);
      warnings.push(m);
    };

    const classifier = this.buildClassifier(warn);
    const ctx = this.sourceContext();
    const inputs: ScanInput[] = [];
    let matched = 0;

    for (const file of files) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
      const body = frontmatter ? "" : await this.app.vault.cachedRead(file);
      const signals = extractSignals({ path: file.path, frontmatter, body });

      const classification: Classification = await classifier.classify(signals, this.settings.categories);
      if (classification.categoryId) matched += 1;

      const category = this.settings.categories.find((c) => c.id === classification.categoryId);
      const resolved = category ? resolveIcon(category.icon, category.fallbackIcon, ctx) : null;

      const current = frontmatter?.[FRONTMATTER_KEY];
      inputs.push({
        path: file.path,
        currentIcon: typeof current === "string" && current.length > 0 ? current : null,
        classification,
        icon: resolved?.ref ? `${resolved.ref.source}:${resolved.ref.key}` : null,
      });
    }

    const plan = buildPlan(inputs, {
      overwriteExisting: options.force === true || this.settings.overwriteExisting,
    });

    if (warnings.length > 0) new Notice(warnings.join("\n"), 10000);
    if (plan.changes.length === 0) {
      new Notice(`Auto Icon：没有需要写入的图标（扫描 ${files.length} 个笔记）。`);
      return;
    }

    const proceed = (): void => void this.applyPlan(plan.changes);
    if (this.settings.previewBeforeWrite) {
      new IconPreviewModal(
        this.app,
        {
          plan,
          scopeDescription: description,
          matchedCount: matched,
          consideredCount: files.length,
          aiEnabled: this.settings.ai.enabled,
        },
        proceed
      ).open();
    } else {
      proceed();
    }
  }

  private async applyPlan(changes: IconChange[]): Promise<void> {
    let written = 0;
    const failures: string[] = [];

    for (const change of changes) {
      const file = this.app.vault.getAbstractFileByPath(change.path);
      if (!(file instanceof TFile)) {
        failures.push(`${change.path}（文件已不存在）`);
        continue;
      }
      try {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          if (change.after === null) delete fm[FRONTMATTER_KEY];
          else fm[FRONTMATTER_KEY] = change.after;
        });
        written += 1;
      } catch (error) {
        failures.push(`${change.path}（${String(error)}）`);
      }
    }

    const message = `Auto Icon：已写入 ${written}/${changes.length} 个图标`;
    new Notice(failures.length > 0 ? `${message}，${failures.length} 个失败（详见控制台）` : message, 8000);
    if (failures.length > 0) console.error("[auto-icon] failed:\n" + failures.join("\n"));
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
    try {
      this.lucideIds = new Set(getIconIds());
    } catch {
      this.lucideIds = new Set();
    }

    const options: Array<{ label: string; value: string }> = [];
    for (const category of this.settings.categories) {
      const resolved = resolveIcon(category.icon, category.fallbackIcon, this.sourceContext());
      options.push({
        label: `${category.name}${resolved?.usedFallback ? "（回退图标）" : ""}`,
        value: resolved ? `${resolved.ref.source}:${resolved.ref.key}` : category.icon,
      });
    }
    for (const source of this.settings.userSources) {
      for (const [key, glyph] of Object.entries(source.icons)) {
        options.push({ label: `${source.name} · ${key}`, value: `${source.id}:${key}` });
      }
    }
    if (options.length === 0) {
      new Notice("Auto Icon：还没有可用图标。");
      return;
    }

    const chosen = await new Promise<string | null>((resolve) => {
      new QuickIconPicker(this.app, options, (value) => resolve(value)).open();
    });
    if (chosen === null) return;

    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm[FRONTMATTER_KEY] = chosen;
    });
    new Notice(`Auto Icon：已为 ${file.path} 设置图标。`);
  }

  async clearCurrentNoteIcon(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Auto Icon：没有打开的笔记。");
      return;
    }
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      delete fm[FRONTMATTER_KEY];
    });
    new Notice(`Auto Icon：已清除 ${file.path} 的图标。`);
  }
}

/**
 * Minimal picker for the manual command.
 *
 * Kept in `main.ts` rather than its own module because it is a single-purpose wrapper around a
 * `SuggestModal`, and splitting it out would cost more indirection than it saves.
 */
class QuickIconPicker extends SuggestModal<{ label: string; value: string }> {
  constructor(
    app: App,
    private readonly options: Array<{ label: string; value: string }>,
    private readonly onPick: (value: string) => void
  ) {
    super(app);
    this.setPlaceholder("选择一个图标…");
  }

  getSuggestions(query: string): Array<{ label: string; value: string }> {
    const q = query.toLowerCase();
    return this.options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }

  renderSuggestion(value: { label: string; value: string }, el: HTMLElement): void {
    el.setText(value.label);
  }

  onChooseSuggestion(item: { label: string; value: string }): void {
    this.onPick(item.value);
  }
}