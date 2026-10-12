import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { AiClassifier } from "./ai";
import { assertCategoryLimit, CATEGORY_LIMIT, cloneCategories } from "./categories";
import { extractSignals, RuleClassifier, type NoteClassifier } from "./classifier";
import { loadIconSet, setIconSetLoader, shapeFor, ICON_SET_PATH } from "./iconset";
import { IconPickerModal } from "./IconPickerModal";
import { applyIcon, detectIcon, stripIcon } from "./placement";
import { buildPlan, type IconChange, type ScanInput } from "./planner";
import { PreviewModal } from "./previewModal";
import { IconSettingsTab } from "./SettingsTab";
import {
  ACTIVATION_HINT,
  withDefaults,
  type AutoIconSettings,
} from "./settings";

/**
 * Auto Icon — put an icon at the top of each note, chosen from its content.
 *
 * Standalone by construction: the default classifier is local rules, so the plugin needs no key, no
 * network and no host-provided icon set. The icon path data ships in the bundle (one Phosphor
 * weight, MIT), and the other five download once on demand and cache locally.
 *
 * The run is linear and inspectable — resolve scope → read → classify → plan → show → write — and
 * nothing is written until the user has seen exactly which notes would change and how.
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
    this.addRibbonIcon("sparkles", "Auto Icon：为当前笔记添加图标", () => {
      void this.scanCurrentNote();
    });

    this.addCommand({
      id: "assign-current",
      name: "为当前笔记添加图标",
      callback: () => void this.scanCurrentNote(),
    });
    this.addCommand({
      id: "scan-vault",
      name: "扫描整个 vault 并添加图标",
      callback: () => void this.scanScope(this.settings.scopeFolder),
    });
    this.addCommand({
      id: "scan-folder",
      name: "扫描当前文件夹并添加图标",
      callback: () => void this.scanCurrentFolder(),
    });
    this.addCommand({
      id: "restyle",
      name: "把全库图标换成当前样式",
      callback: () => void this.scanScope(this.settings.scopeFolder, { force: true, restyle: true }),
    });
    this.addCommand({
      id: "clear-current",
      name: "清除当前笔记的图标",
      callback: () => void this.clearCurrentNoteIcon(),
    });

    if (!this.settings.activationHintDismissed) this.showActivationHint();
  }

  /* ---------------------------------------------------------------- *
   * Settings
   * ---------------------------------------------------------------- */

  async loadSettings(): Promise<void> {
    this.settings = withDefaults(await this.loadData());
    // The loader reads from the plugin folder, so it has to be installed before any icon is shown.
    setIconSetLoader(() => this.loadIconSet());
  }

  async saveSettings(): Promise<void> {
    assertCategoryLimit(this.settings.categories);
    await this.saveData(this.settings);
  }

  get remainingCategorySlots(): number {
    return Math.max(0, CATEGORY_LIMIT - this.settings.categories.length);
  }

  showActivationHint(): void {
    new Notice(ACTIVATION_HINT, 12000);
  }

  /**
   * Local rules by default; the AI classifier wraps them so any failure degrades back rather than
   * leaving a note without an icon.
   */
  private buildClassifier(onWarning: (message: string) => void): NoteClassifier {
    const rules = new RuleClassifier({
      minScore: this.settings.minScore,
      weights: this.settings.weights,
    });
    if (!this.settings.ai.enabled) return rules;
    return new AiClassifier(this.settings.ai, rules, undefined, onWarning);
  }

  /* ---------------------------------------------------------------- *
   * Icon set
   * ---------------------------------------------------------------- */

  /**
   * Read the bundled icon set.
   *
   * It is a sibling file rather than part of the bundle, so it is read once and only when an icon
   * is actually needed. `loadIconSet` de-duplicates concurrent callers, so a scan that resolves many
   * icons at once still reads the file exactly once.
   */
  async loadIconSet(): Promise<import("./iconset").IconSetMeta> {
    return loadIconSet(async () => {
      const path = normalizePath(`${this.manifest.dir ?? ".obsidian/plugins/auto-icon"}/${ICON_SET_PATH}`);
      const text = await this.app.vault.adapter.read(path);
      return JSON.parse(text) as import("./iconset").IconSetMeta;
    });
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

  async scanScope(
    scopeFolder: string,
    options: { force?: boolean; restyle?: boolean } = {}
  ): Promise<void> {
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
    options: { force?: boolean; restyle?: boolean } = {}
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
    const theme = this.settings.iconTheme;
    const size = this.settings.iconSize;

    const contents = new Map<string, string>();
    for (const file of files) contents.set(file.path, await this.app.vault.read(file));

    // One read of the icon set for the whole run, not one per note.
    const set = await this.loadIconSet();

    const inputs: ScanInput[] = [];
    let matched = 0;

    for (const file of files) {
      const raw = contents.get(file.path) ?? "";
      const { body } = splitFrontmatter(raw);
      const frontmatter = parseFrontmatter(raw);

      const signals = extractSignals({ path: file.path, frontmatter, body });
      const classification = await classifier.classify(signals, this.settings.categories);
      const category = this.settings.categories.find((c) => c.id === classification.categoryId);
      if (category) matched += 1;

      inputs.push({
        path: file.path,
        current: detectIcon(body),
        classification,
        categoryId: category?.id ?? null,
        icon: category?.icon ?? null,
        shape: category ? shapeFor(set, category.icon, theme, this.settings.accentColor) : null,
        theme,
        size,
      });
    }

    // A pure restyle keeps each note's existing icon and only changes how it looks — the category
    // stays whatever the user last accepted, which is the whole point of "换样式" as a separate verb
    // from "重新分类".
    const prepared = options.restyle
      ? inputs.map((i) =>
          i.current
            ? { ...i, icon: i.current.icon, shape: shapeFor(set, i.current.icon, theme, this.settings.accentColor) }
            : i
        )
      : inputs;

    const plan = buildPlan(prepared, {
      overwriteExisting: options.force === true || this.settings.overwriteExisting,
    });

    if (warnings.length > 0) new Notice(warnings.join("\n"), 10000);
    if (plan.changes.length === 0) {
      new Notice(`Auto Icon：没有需要写入的图标（扫描 ${files.length} 个笔记）。`);
      return;
    }

    const proceed = (): void => void this.applyPlan(plan.changes, contents);
    if (this.settings.previewBeforeWrite) {
      new PreviewModal(
        this.app,
        { plan, scopeDescription: description, matched, considered: files.length, aiEnabled: this.settings.ai.enabled, theme },
        proceed
      ).open();
    } else {
      proceed();
    }
  }

  private async applyPlan(changes: IconChange[], contents: Map<string, string>): Promise<void> {
    let written = 0;
    const failures: string[] = [];

    for (const change of changes) {
      const file = this.app.vault.getAbstractFileByPath(change.path);
      if (!(file instanceof TFile)) {
        failures.push(`${change.path}（文件已不存在）`);
        continue;
      }
      try {
        const raw = contents.get(change.path) ?? (await this.app.vault.read(file));
        const { frontmatterText, body } = splitFrontmatter(raw);
        const next =
          change.shape === null
            ? stripIcon(body)
            : applyIcon(body, change.shape, change.after as string, change.theme, change.size);
        await this.app.vault.modify(file, frontmatterText + next);
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

  async pickIconForCategory(categoryId: string): Promise<void> {
    const category = this.settings.categories.find((c) => c.id === categoryId);
    if (!category) return;

    const chosen = await new Promise<string | null>((resolve) => {
      const modal = new IconPickerModal(this.app, category.icon, this.settings.iconTheme, (value) =>
        resolve(value)
      );
      modal.onLoadSet = () => this.loadIconSet();
      modal.open();
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
    const raw = await this.app.vault.read(file);
    const { frontmatterText, body } = splitFrontmatter(raw);
    if (!detectIcon(body)) {
      new Notice("Auto Icon：当前笔记没有图标。");
      return;
    }
    await this.app.vault.modify(file, frontmatterText + stripIcon(body));
    new Notice(`Auto Icon：已清除 ${file.path} 的图标。`);
  }
}

/* ------------------------------------------------------------------ *
 * Frontmatter splitting
 *
 * Deliberately local rather than via Obsidian's `getFrontMatterInfo`: the icon goes into the *body*,
 * so the frontmatter has to be preserved byte-for-byte on both sides of every edit, and a local split
 * makes that behaviour testable in plain Node.
 * ------------------------------------------------------------------ */

export function splitFrontmatter(raw: string): { frontmatterText: string; body: string } {
  const match = /^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?)/.exec(raw);
  if (!match) return { frontmatterText: "", body: raw };
  return { frontmatterText: match[1], body: raw.slice(match[1].length) };
}

/** Minimal flat frontmatter reader, enough for `tags:` and `type:`. */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const { frontmatterText } = splitFrontmatter(raw);
  if (!frontmatterText) return {};

  const out: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const line of frontmatterText.split(/\r?\n/).slice(1, -1)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      const existing = out[currentKey];
      out[currentKey] = Array.isArray(existing) ? [...(existing as string[]), item[1].trim()] : [item[1].trim()];
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      out[currentKey] = kv[2].trim();
    }
  }
  return out;
}