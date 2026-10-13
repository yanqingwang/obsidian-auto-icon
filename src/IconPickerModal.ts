import { Modal, setIcon, type App } from "obsidian";
import {
  collectionName,
  searchIcons,
  shapeFor,
  THEME_LIST,
  type IconSetMeta,
} from "./iconset";
import { isIconTheme, renderIconLine, type IconThemeName } from "./placement";

/**
 * mXn icon picker.
 *
 * Search accepts every way people actually write an mXn name — `folder-outline`, `folder outline`,
 * `folderoutline` — because telling someone to type a specific separator is the kind of instruction
 * that works right up until the moment it doesn't.
 *
 * Each cell renders the real icon and shows the mXn name on hover, so a choice is made by looking
 * and the exact identifier is always one hover (or one click) away to copy into somewhere else.
 */

const PAGE = 300;

export class IconPickerModal extends Modal {
  private query = "";
  private grid: HTMLElement | null = null;
  private result: HTMLElement | null = null;
  private selected: string;
  private theme: IconThemeName;
  private loaded = false;

  constructor(
    app: App,
    private readonly set: IconSetMeta,
    theme: IconThemeName,
    currentIcon: string,
    private readonly onPick: (icon: string) => void,
  ) {
    super(app);
    this.theme = theme;
    this.selected = currentIcon;
  }

  onOpen(): void {
    this.titleEl.setText(`选择图标 · ${this.set.prefix}:`);
    this.render();
  }

  private render(): void {
    if (this.loaded) return;
    this.loaded = true;
    const { contentEl } = this;

    const search = contentEl.createEl("input", {
      cls: "ai-search",
      attr: {
        type: "search",
        placeholder: `搜索 ${this.set.count} 个 ${this.set.prefix} 图标，例如 folder`,
      },
    });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderGrid();
    });
    search.addEventListener("keydown", (event) => {
      // Enter picks whatever is currently highlighted, which is the first result after a search.
      if (event.key !== "Enter") return;
      event.preventDefault();
      const first = this.grid?.querySelector<HTMLElement>(".ai-cell");
      this.choose(first?.dataset["icon"] ?? this.selected);
    });

    // The theme is chosen here rather than buried in settings: outline-vs-filled only makes sense
    // while you are looking at the icon.
    const themes = contentEl.createDiv({ cls: "ai-style-row" });
    for (const option of THEME_LIST) {
      const button = themes.createEl("button", {
        text: option.label,
        cls: option.name === this.theme ? "is-active" : "",
      });
      button.addEventListener("click", () => {
        this.theme = option.name;
        for (const el of themes.children) el.classList.remove("is-active");
        button.classList.add("is-active");
        this.renderGrid();
      });
    }

    this.result = contentEl.createDiv({ cls: "ai-result" });
    this.grid = contentEl.createDiv({ cls: "ai-grid" });
    this.renderGrid();

    const footer = contentEl.createDiv({ cls: "ai-picker-footer" });
    footer.createEl("span", {
      cls: "ai-muted",
      text: `${this.set.source} · ${this.set.package}（${this.set.license}）· ${this.set.count} 个图标，已缓存在本地`,
    });
    const cancel = footer.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());

    search.focus();
  }

  private renderGrid(): void {
    const grid = this.grid;
    const result = this.result;
    if (!grid || !result) return;
    grid.empty();
    result.empty();

    const matches = searchIcons(this.set, this.query, PAGE);
    const total = this.query.trim()
      ? searchIcons(this.set, this.query, 100000).length
      : this.set.count;

    result.createSpan({
      text:
        matches.length === 0
          ? `没有匹配「${this.query.trim()}」`
          : `${matches.length}${matches.length < total ? ` / ${total}` : ""} 个结果`,
    });

    for (const name of matches) {
      const cell = grid.createDiv({
        cls: "ai-cell" + (name === this.selected ? " is-selected" : ""),
        attr: { title: collectionName(this.set, name) },
      });
      cell.dataset["icon"] = name;

      const shape = shapeFor(this.set, name, this.theme);
      if (shape) cell.innerHTML = renderIconLine(shape, name, this.theme, 24);
      else setIcon(cell, "question");

      cell.addEventListener("click", () => this.choose(name));
    }
  }

  private choose(name: string): void {
    if (!name) return;
    this.close();
    this.onPick(name);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
