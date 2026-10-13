import { Modal, Notice, Setting, type App } from "obsidian";
import { DEFAULT_CATEGORIES, type Category } from "./categories";
import { IconPickerModal } from "./IconPickerModal";
import { collectionName, shapeFor } from "./iconset";
import { isIconTheme, renderIconLine } from "./placement";
import type { AutoIconHost } from "./settings";
import { fire } from "./callbacks";

/**
 * Everything about one category, edited in a modal.
 *
 * This lives in its own file, at module scope, with a static `Modal` import. It was previously a
 * class declared inside an async method that pulled `Modal` via `await import("obsidian")` — which
 * esbuild leaves as a literal dynamic import inside the CommonJS bundle. `Modal` came back
 * undefined, `class extends Modal` threw, and because the caller used `void`, the whole thing failed
 * silently: the edit button appeared to do nothing.
 *
 * A dynamically imported base class in a CJS bundle is a trap with no upside here.
 */
export class CategoryEditorModal extends Modal {
  constructor(
    app: App,
    private readonly host: AutoIconHost,
    private readonly category: Category,
    private readonly isCustom: boolean,
    private readonly onSaved: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `编辑类别 · ${this.category.name}` });

    this.renderIconRow(contentEl);
    this.renderTextFields(contentEl);
    this.renderButtons(contentEl);
  }

  private renderIconRow(containerEl: HTMLElement): void {
    const settings = this.host.settings;
    const row = new Setting(containerEl).setName("图标");

    const preview = row.infoEl.createSpan({ cls: "ai-icon-preview" });
    this.paintPreview(preview, settings.iconTheme, settings.iconSize);

    row.addButton((b) =>
      b.setButtonText("从 mXn 图标库选择…").onClick(
        fire(async () => {
          const set = await this.host.loadIconSet();
          const chosen = await new Promise<string | null>((resolve) => {
            new IconPickerModal(
              this.app,
              set,
              settings.iconTheme,
              this.category.icon,
              (value) => resolve(value),
            ).open();
          });
          if (!chosen) return;
          this.category.icon = chosen;
          await this.host.saveSettings();
          this.paintPreview(preview, settings.iconTheme, settings.iconSize);
          this.onSaved();
        }),
      ),
    );
  }

  private paintPreview(el: HTMLElement, theme: string, size: number): void {
    const set = this.host.iconSetMeta ?? this.host.set;
    const iconTheme = isIconTheme(theme) ? theme : "outline";
    const resolved = set ? shapeFor(set, this.category.icon, iconTheme) : null;
    el.innerHTML = resolved
      ? renderIconLine(resolved, this.category.icon, iconTheme, size)
      : "";
    el.setAttribute(
      "title",
      this.host.iconSetMeta
        ? collectionName(this.host.iconSetMeta, this.category.icon)
        : "",
    );
  }

  private renderTextFields(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("mXn 名称")
      .setDesc("可以直接粘贴或手改，例如 folder-outline。")
      .addText((t) =>
        t
          .setPlaceholder("folder")
          .setValue(this.category.icon)
          .onChange(
            fire(async (value) => {
              this.category.icon = value.trim().toLowerCase();
              await this.host.saveSettings();
            }),
          ),
      );

    new Setting(containerEl)
      .setName("关键词")
      .setDesc("空格分隔，用于匹配笔记内容、标题和文件夹。")
      .addText((t) =>
        t
          .setPlaceholder("设计 ui ux")
          .setValue(this.category.keywords.join(" "))
          .onChange(
            fire(async (value) => {
              this.category.keywords = value
                .toLowerCase()
                .split(/\s+/)
                .filter(Boolean);
              await this.host.saveSettings();
            }),
          ),
      );

    new Setting(containerEl).setName("说明").addText((t) =>
      t.setValue(this.category.description).onChange(
        fire(async (value) => {
          this.category.description = value;
          await this.host.saveSettings();
        }),
      ),
    );
  }

  private renderButtons(containerEl: HTMLElement): void {
    const buttons = containerEl.createDiv({ cls: "ai-buttons" });

    if (!this.isCustom) {
      const reset = buttons.createEl("button", { text: "恢复默认" });
      reset.addEventListener("click", async () => {
        const original = DEFAULT_CATEGORIES.find(
          (c) => c.id === this.category.id,
        );
        if (!original) return;
        this.category.icon = original.icon;
        this.category.keywords = [...original.keywords];
        await this.host.saveSettings();
        this.close();
        this.onSaved();
        new Notice(`已恢复「${original.name}」的默认图标和关键词。`);
      });
    }

    const remove = buttons.createEl("button", {
      text: "删除类别",
      cls: "mod-warning",
    });
    remove.addEventListener("click", async () => {
      const settings = this.host.settings;
      if (settings.categories.length <= 1) {
        new Notice("Auto Icon：至少要保留一个类别。");
        return;
      }
      settings.categories = settings.categories.filter(
        (c) => c.id !== this.category.id,
      );
      await this.host.saveSettings();
      this.close();
      this.onSaved();
    });

    const done = buttons.createEl("button", { text: "完成", cls: "mod-cta" });
    done.addEventListener("click", () => {
      this.close();
      this.onSaved();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Open the editor for a category. Kept as a function so callers do not repeat the constructor. */
export function editCategory(
  app: App,
  host: AutoIconHost,
  category: Category,
  isCustom: boolean,
  onSaved: () => void,
): CategoryEditorModal {
  const modal = new CategoryEditorModal(app, host, category, isCustom, onSaved);
  modal.open();
  return modal;
}
