import { FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFolder, type App } from "obsidian";
import { CATEGORY_LIMIT, DEFAULT_CATEGORIES, type Category } from "./categories";
import type { SignalWeightsKey } from "./classifier";
import { IconPickerModal } from "./IconPickerModal";
import { shapeFor } from "./iconset";
import { renderIconLine } from "./placement";
import type { AutoIconHost } from "./settings";

/**
 * Settings.
 *
 * Two rules, both from the redesign:
 *
 * 1. **No icon is ever typed.** Icons come from an mXn picker that renders them; the only free-text
 *    fields left are a folder path, a category's display name and its keywords.
 * 2. **The built-in list stays readable at 32 rows.** Each category is one compact line — icon, name,
 *    one chevron — and everything else (icon choice, keywords, delete, restore) lives in a modal
 *    opened from that line. A settings row that carries four controls is what turned the list into a
 *    wall; a row that carries one is not.
 */

class FolderSuggest extends FuzzySuggestModal<string> {
  constructor(app: App, private readonly onChoose: (folder: string) => void) {
    super(app);
    this.setPlaceholder("选择文件夹…");
  }

  getItems(): string[] {
    const out: string[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          out.push(child.path);
          walk(child);
        }
      }
    };
    walk(this.app.vault.getRoot());
    return out;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onChoose(item);
  }
}

const WEIGHT_ROWS: Array<[SignalWeightsKey, string]> = [
  ["declared", "frontmatter 声明"],
  ["tagExact", "标签精确命中"],
  ["tagKeyword", "标签关键词命中"],
  ["folder", "文件夹"],
  ["basename", "文件名"],
  ["heading", "小标题"],
  ["excerpt", "正文"],
];

export class IconSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: AutoIconHost) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.renderActivation(containerEl);
    this.renderAppearance(containerEl);
    this.renderScope(containerEl);
    this.renderMatching(containerEl);
    this.renderBehaviour(containerEl);
    this.renderAi(containerEl);
    this.renderCategories(containerEl);
  }

  private refresh(): void {
    this.display();
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
  }

  private renderActivation(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("自动图标").setHeading();

    new Setting(containerEl)
      .setName("怎么开始")
      .setDesc("一句话：运行命令「为当前笔记分配图标」，图标会出现在左侧文件树里。笔记文件本身不会被修改。")
      .addButton((b) =>
        b.setButtonText("再提示一次").onClick(async () => {
          this.plugin.showActivationHint();
          await this.save();
        })
      )
      .addButton((b) =>
        b.setButtonText("清除当前笔记图标").onClick(async () => {
          await this.plugin.clearCurrentNoteIcon();
        })
      );
  }

  private renderAppearance(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("外观").setHeading();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("图标样式")
      .setDesc(
        "「线性」对应 mdi 的 -outline 图标，「填充」对应基础图标。mdi 只对一部分图标提供线性版本，" +
          "缺失时会自动回退并保持可用。"
      )
      .addDropdown((d) => {
        d.addOption("filled", "填充");
        d.addOption("outline", "线性");
        d.setValue(settings.iconStyle).onChange(async (value) => {
          settings.iconStyle = value as "filled" | "outline";
          await this.save();
          this.refresh();
        });
      });

    new Setting(containerEl)
      .setName("图标大小")
      .setDesc("在文件树里显示的大小（像素）。")
      .addSlider((s) =>
        s.setLimits(12, 32, 1).setDynamicTooltip().setValue(settings.iconSize).onChange(async (value) => {
          settings.iconSize = value;
          await this.save();
        })
      );
  }

  private renderScope(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("扫描范围").setHeading();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("文件夹")
      .setDesc("留空 = 整个 vault。建议先在一个子文件夹试点，确认效果再全库跑。")
      .addText((text) =>
        text.setPlaceholder("留空则全库").setValue(settings.scopeFolder).onChange(async (value) => {
          settings.scopeFolder = value.trim().replace(/^\/+|\/+$/g, "");
          await this.save();
        })
      )
      .addButton((b) =>
        b.setButtonText("浏览…").onClick(() => {
          new FolderSuggest(this.app, async (folder) => {
            settings.scopeFolder = folder;
            await this.save();
            this.refresh();
          }).open();
        })
      );

    new Setting(containerEl)
      .setName("包含子文件夹")
      .addToggle((t) =>
        t.setValue(settings.includeSubfolders).onChange(async (value) => {
          settings.includeSubfolders = value;
          await this.save();
        })
      );
  }

  private renderMatching(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("匹配").setHeading();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("最低匹配分数")
      .setDesc("低于这个分数就不分配图标。这是防止给每篇笔记乱贴图标的主要闸门。")
      .addSlider((s) =>
        s.setLimits(1, 60, 1).setDynamicTooltip().setValue(settings.minScore).onChange(async (value) => {
          settings.minScore = value;
          await this.save();
        })
      );

    new Setting(containerEl).setName("各信号权重").setDesc("本地规则的计分权重。哪个更可信就调高哪个。");

    for (const [key, label] of WEIGHT_ROWS) {
      new Setting(containerEl)
        .setName(label)
        .setClass("ai-compact")
        .addSlider((s) =>
          s.setLimits(0, 120, 1).setDynamicTooltip().setValue(settings.weights[key]).onChange(async (value) => {
            settings.weights[key] = value;
            await this.save();
          })
        );
    }
  }

  private renderBehaviour(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("行为").setHeading();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("分配前先预览")
      .setDesc("先列出将给哪些笔记分配图标、判定依据是什么，确认后再保存。建议保持开启。")
      .addToggle((t) =>
        t.setValue(settings.previewBeforeWrite).onChange(async (value) => {
          settings.previewBeforeWrite = value;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("覆盖已有图标")
      .setDesc("关闭时只给还没有图标的笔记分配 —— 你手动改过的图标不会被自动替换。")
      .addToggle((t) =>
        t.setValue(settings.overwriteExisting).onChange(async (value) => {
          settings.overwriteExisting = value;
          await this.save();
        })
      );
  }

  private renderAi(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("AI 分类（可选）").setHeading();
    const ai = this.plugin.settings.ai;

    new Setting(containerEl)
      .setName("启用 AI 分类")
      .setDesc("默认关闭 —— 本地规则已经够用。开启后失败会自动回退到本地规则，不会中断扫描。")
      .addToggle((t) =>
        t.setValue(ai.enabled).onChange(async (value) => {
          ai.enabled = value;
          await this.save();
          this.refresh();
        })
      );

    if (!ai.enabled) return;

    new Setting(containerEl)
      .setName("接口地址")
      .setDesc("任何 OpenAI 兼容的 /chat/completions 接口都可以。")
      .addText((t) =>
        t.setValue(ai.baseUrl).onChange(async (value) => {
          ai.baseUrl = value.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("模型")
      .addText((t) =>
        t.setValue(ai.model).onChange(async (value) => {
          ai.model = value.trim();
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("保存在插件目录的 data.json 里（与其它 Obsidian 插件存密钥的位置一致），只用于你配置的接口。")
      .addText((t) => {
        t.inputEl.type = "password";
        return t.setValue(ai.apiKey).onChange(async (value) => {
          ai.apiKey = value.trim();
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName("超时（毫秒）")
      .addText((t) =>
        t.setPlaceholder("30000").setValue(String(ai.timeoutMs)).onChange(async (value) => {
          const n = Number.parseInt(value, 10);
          if (!Number.isNaN(n) && n > 0) {
            ai.timeoutMs = n;
            await this.save();
          }
        })
      );
  }

  /* ---------------------------------------------------------------- *
   * Categories — one compact line each, everything else behind a modal
   * ---------------------------------------------------------------- */

  private renderCategories(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    new Setting(containerEl).setName(`类别（${settings.categories.length}/${CATEGORY_LIMIT}）`).setHeading();

    const builtinIds = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
    const builtin = settings.categories.filter((c) => builtinIds.has(c.id));
    const custom = settings.categories.filter((c) => !builtinIds.has(c.id));

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "点任意一行可更换图标、编辑关键词。内置类别在前，自定义类别在后。",
    });

    const list = containerEl.createDiv({ cls: "ai-cat-list" });
    for (const category of builtin) this.renderCategoryLine(list, category, false);
    if (custom.length > 0) {
      list.createDiv({ cls: "ai-cat-divider", text: "自定义" });
      for (const category of custom) this.renderCategoryLine(list, category, true);
    }

    this.renderAddCategory(containerEl);
  }

  /**
   * One category as a single clickable line.
   *
   * Compact on purpose: at 32 rows the alternative — a full `Setting` per category with a text
   * field and several buttons — is what made this list unreadable.
   */
  private renderCategoryLine(parent: HTMLElement, category: Category, isCustom: boolean): void {
    const row = parent.createDiv({ cls: "ai-cat" + (isCustom ? " is-custom" : "") });
    row.createSpan({ cls: "ai-cat-name", text: category.name });
    row.createSpan({ cls: "ai-cat-id", text: category.id });
    row.createSpan({ cls: "ai-cat-icon", text: category.icon });
    if (category.keywords.length > 0) {
      row.createSpan({ cls: "ai-cat-kwcount", text: `${category.keywords.length} 词` });
    }

    const edit = row.createEl("button", { cls: "ai-cat-edit", attr: { "aria-label": `编辑 ${category.name}` } });
    edit.setText("编辑");
    edit.addEventListener("click", () => {
      void new CategoryEditorModal(this.plugin, category, isCustom, () => this.refresh()).open();
    });
  }

  private renderAddCategory(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    let idField = "";
    let nameField = "";

    new Setting(containerEl)
      .setName("新增类别")
      .setDesc(`还剩 ${Math.max(0, this.plugin.remainingCategorySlots)} 个名额，总上限 ${CATEGORY_LIMIT}。`)
      .addText((t) =>
        t.setPlaceholder("类别 id（英文）").onChange((v) => {
          idField = v.trim();
        })
      )
      .addText((t) =>
        t.setPlaceholder("显示名（中文）").onChange((v) => {
          nameField = v.trim();
        })
      )
      .addButton((b) =>
        b.setButtonText("添加").onClick(async () => {
          if (!idField || !nameField) {
            new Notice("Auto Icon：类别 id 和显示名都要填。");
            return;
          }
          if (this.plugin.remainingCategorySlots <= 0) {
            new Notice(`Auto Icon：已达上限 ${CATEGORY_LIMIT} 个类别，请先删除一个。`);
            return;
          }
          if (settings.categories.some((c) => c.id === idField)) {
            new Notice(`Auto Icon：类别 id "${idField}" 已存在。`);
            return;
          }
          settings.categories.push({
            id: idField,
            name: nameField,
            description: "自定义类别",
            icon: "star",
            keywords: [],
          });
          await this.save();
          this.refresh();
        })
      );
  }
}

/** Everything about one category, edited in a modal rather than inline. */
class CategoryEditorModal {
  constructor(
    private readonly plugin: AutoIconHost,
    private readonly category: Category,
    private readonly isCustom: boolean,
    private readonly onClose: () => void
  ) {}

  async open(): Promise<void> {
    const { App, Modal } = await import("obsidian");
    const app = this.plugin.app;

    class Editor extends Modal {
      constructor(app: App, private readonly host: CategoryEditorModal) {
        super(app);
      }

      onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: `编辑类别 · ${this.host.category.name}` });

        const row = new Setting(contentEl).setName("图标");
        const set = this.host.plugin.iconSetMeta;
        const resolved = set ? shapeFor(set, this.host.category.icon, this.host.plugin.settings.iconStyle) : null;
        const preview = row.infoEl.createSpan({ cls: "ai-icon-preview" });
        if (resolved) {
          preview.innerHTML = renderIconLine(
            resolved.shape,
            resolved.name,
            this.host.plugin.settings.iconStyle,
            24
          );
        }
        row.addButton((b) =>
          b.setButtonText("选择图标").onClick(async () => {
            const iconSet = await this.host.plugin.loadIconSet();
            const chosen = await new Promise<string | null>((resolve) => {
              new IconPickerModal(this.app, iconSet, this.host.plugin.settings.iconStyle, (v) => resolve(v)).open();
            });
            if (chosen) {
              this.host.category.icon = chosen;
              await this.host.plugin.saveSettings();
              this.refreshPreview();
            }
          })
        );

        new Setting(contentEl).setName("mXn 名称").setDesc("可以直接粘贴或手改，例如 folder-outline。").addText((t) =>
          t.setPlaceholder("folder").setValue(this.host.category.icon).onChange(async (value) => {
            this.host.category.icon = value.trim().toLowerCase();
            await this.host.plugin.saveSettings();
          })
        );

        new Setting(contentEl).setName("关键词").setDesc("空格分隔，用于匹配笔记。").addText((t) =>
          t.setPlaceholder("设计 ui ux").setValue(this.host.category.keywords.join(" ")).onChange(async (value) => {
            this.host.category.keywords = value.toLowerCase().split(/\s+/).filter(Boolean);
            await this.host.plugin.saveSettings();
          })
        );

        new Setting(contentEl).setName("说明").addText((t) =>
          t.setValue(this.host.category.description).onChange(async (value) => {
            this.host.category.description = value;
            await this.host.plugin.saveSettings();
          })
        );

        const buttons = contentEl.createDiv({ cls: "ai-buttons" });
        const close = buttons.createEl("button", { text: "完成", cls: "mod-cta" });
        close.addEventListener("click", () => {
          this.close();
          this.host.onClose();
        });

        if (!this.host.isCustom) {
          const reset = buttons.createEl("button", { text: "恢复默认图标和关键词" });
          reset.addEventListener("click", async () => {
            const original = DEFAULT_CATEGORIES.find((c) => c.id === this.host.category.id);
            if (!original) return;
            this.host.category.icon = original.icon;
            this.host.category.keywords = [...original.keywords];
            await this.host.plugin.saveSettings();
            this.refreshPreview();
            new Notice(`已恢复 ${original.name} 的默认值。`);
          });
        }

        const remove = buttons.createEl("button", { text: "删除类别", cls: "mod-warning" });
        remove.addEventListener("click", async () => {
          const settings = this.host.plugin.settings;
          settings.categories = settings.categories.filter((c) => c.id !== this.host.category.id);
          await this.host.plugin.saveSettings();
          this.close();
          this.host.onClose();
        });
      }

      private async refreshPreview(): Promise<void> {
        const span = this.contentEl.querySelector(".ai-icon-preview");
        const set = this.host.plugin.iconSetMeta ?? (await this.host.plugin.loadIconSet());
        const resolved = shapeFor(set, this.host.category.icon, this.host.plugin.settings.iconStyle);
        if (span) {
          span.innerHTML = resolved
            ? renderIconLine(resolved.shape, resolved.name, this.host.plugin.settings.iconStyle, 24)
            : "";
        }
      }

      onClose(): void {
        this.contentEl.empty();
      }
    }

    new Editor(app, this).open();
  }
}