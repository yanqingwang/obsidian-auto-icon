import { App, Modal, Notice } from "obsidian";
import { iconNames, loadedIconSet, shapeFor, type IconSetMeta } from "./iconset";
import { renderIconLine, THEMES, type IconThemeName } from "./placement";

/**
 * Icon picker.
 *
 * This exists because the previous version asked people to type `lucide:folder-kanban`. That is a
 * typo waiting to happen, it offers no way to see the icon before committing, and it made the
 * plugin's own icon vocabulary part of its interface.
 *
 * So: a searchable grid of the real rendered icons, filterable as you type, with a theme switch so
 * the style can be chosen from the same place rather than hunting through settings. Nothing here is
 * ever typed.
 */

const PAGE = 240;

export class IconPickerModal extends Modal {
  private set: IconSetMeta | null = null;
  private theme: IconThemeName = "outline";
  private query = "";
  private grid: HTMLElement | null = null;
  private loaded = false;

  private selected: string;

  constructor(
    app: App,
    currentIcon: string,
    theme: IconThemeName,
    private readonly onPick: (icon: string) => void
  ) {
    super(app);
    this.theme = theme;
    this.selected = currentIcon;
  }

  onOpen(): void {
    this.titleEl.setText("选择图标");
    this.contentEl.empty();
    this.loaded = false;
    void this.ensureSet().then(() => this.render());
  }

  private async ensureSet(): Promise<IconSetMeta | null> {
    if (this.set) return this.set;
    this.set = loadedIconSet();
    if (this.set) return this.set;
    try {
      this.set = await this.plugin().loadIconSet();
      return this.set;
    } catch (error) {
      new Notice(`Auto Icon：图标集加载失败。${String(error)}`, 10000);
      return null;
    }
  }

  /** Injected by the plugin so the modal does not reach for a global. */
  onLoadSet: (() => Promise<IconSetMeta>) | null = null;

  private plugin(): { loadIconSet: () => Promise<IconSetMeta> } {
    if (!this.onLoadSet) throw new Error("Auto Icon: icon set loader not configured");
    return { loadIconSet: this.onLoadSet };
  }

  private render(): void {
    if (this.loaded) return;
    this.loaded = true;
    const { contentEl } = this;

    const bar = contentEl.createDiv({ cls: "ai-picker-bar" });

    const search = bar.createEl("input", {
      cls: "ai-picker-search",
      attr: { type: "search", placeholder: "搜索图标…" },
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderGrid();
    });

    const themeBar = bar.createDiv({ cls: "ai-picker-themes" });
    for (const theme of THEMES) {
      const button = themeBar.createEl("button", {
        text: theme.label,
        cls: theme.name === this.theme ? "is-active" : "",
      });
      button.addEventListener("click", () => {
        this.theme = theme.name;
        for (const el of themeBar.children) el.classList.remove("is-active");
        button.classList.add("is-active");
        this.renderGrid();
      });
    }

    this.grid = contentEl.createDiv({ cls: "ai-picker-grid" });
    this.renderGrid();

    const footer = contentEl.createDiv({ cls: "ai-picker-footer" });
    const set = this.set;
    footer.createEl("span", {
      cls: "ai-muted",
      text: set
        ? `来源：${set.source} · ${set.package}（${set.license}）· ${set.count} 个图标，已缓存在本地`
        : "图标集未加载",
    });
    const cancel = footer.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
  }

  private renderGrid(): void {
    const grid = this.grid;
    const set = this.set;
    if (!grid || !set) return;
    grid.empty();

    const q = this.query.trim().toLowerCase();
    const all = iconNames(set);
    const matches = q ? all.filter((n) => n.includes(q) || n.replace(/-/g, " ").includes(q)) : all;
    const shown = matches.slice(0, PAGE);

    if (shown.length === 0) {
      grid.createEl("p", { cls: "ai-muted", text: `没有匹配「${this.query}」的图标。` });
      return;
    }

    for (const name of shown) {
      const shape = shapeFor(set, name, this.theme);
      if (!shape) continue;

      const cell = grid.createDiv({
        cls: "ai-picker-cell" + (name === this.selected ? " is-selected" : ""),
        attr: { title: name },
      });
      // The same function that writes notes, so what is previewed is exactly what gets written.
      cell.innerHTML = renderIconLine(shape, name, this.theme, 22);
      cell.addEventListener("click", () => {
        this.close();
        this.onPick(name);
      });
    }

    if (matches.length > shown.length) {
      grid.createEl("p", {
        cls: "ai-muted",
        text: `还有 ${matches.length - shown.length} 个匹配项，请继续输入以缩小范围。`,
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}