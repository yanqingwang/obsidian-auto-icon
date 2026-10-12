import { FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFolder, type App } from "obsidian";
import { CATEGORY_LIMIT, DEFAULT_CATEGORIES, type Category } from "./categories";
import type { SignalWeightsKey } from "./classifier";
import { IconPickerModal } from "./IconPickerModal";
import { loadedIconSet, shapeFor } from "./iconset";
import { renderIconLine, THEMES, themeByName, type IconThemeName } from "./placement";
import type { AutoIconHost } from "./settings";

/**
 * Settings.
 *
 * Two rules here, both from the redesign:
 *
 * 1. **No icon is ever typed.** Icons are chosen from a rendered grid, styles from a dropdown that
 *    labels each weight in Chinese. The only free-text fields left are a folder path, a category's
 *    display name and its keywords — things that genuinely have no fixed vocabulary.
 * 2. **The icon style is one global setting**, not per category. Restyling the vault is then one
 *    dropdown instead of 32 edits, and "换样式" stays a distinct verb from "重新分类".
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
      .setDesc("一句话：运行命令「为当前笔记添加图标」，图标会出现在笔记开头。")
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
        "切换样式是全库生效的。想让已写好的笔记也换样式，改完运行命令「把全库图标换成当前样式」——" +
          "它只换外观，不重新分类。"
      )
      .addDropdown((d) => {
        for (const theme of THEMES) d.addOption(theme.name, theme.label);
        d.setValue(settings.iconTheme).onChange(async (value) => {
          settings.iconTheme = value as IconThemeName;
          settings.accentColor = value === "outline" || value === "filled" ? settings.accentColor : value;
          await this.save();
          this.refresh();
        });
      });

    if (settings.iconTheme === "two-tone" || settings.iconTheme === "multi-color") {
      new Setting(containerEl)
        .setName("强调色")
        .setDesc("双色和多彩样式里非文字部分的颜色。")
        .addText((t) =>
          t.setPlaceholder("#2f88ff").setValue(settings.accentColor).onChange(async (value) => {
            const trimmed = value.trim();
            if (!/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return;
            settings.accentColor = trimmed;
            await this.save();
          })
        );
    }

    new Setting(containerEl)
      .setName("图标大小")
      .setDesc("图标在笔记里显示的高度（像素）。")
      .addSlider((s) =>
        s
          .setLimits(12, 48, 1)
          .setDynamicTooltip()
          .setValue(settings.iconSize)
          .onChange(async (value) => {
            settings.iconSize = value;
            await this.save();
          })
      );

    // Live preview at the current theme and size.
    const first = settings.categories[0];
    const set = loadedIconSet();
    if (first && set) {
      const shape = shapeFor(set, first.icon, settings.iconTheme);
      const preview = new Setting(containerEl)
        .setName("预览")
        .setDesc(`${first.name} 在「${themeByName(settings.iconTheme, settings.accentColor).label}」样式下的样子`)
        .setClass("ai-preview-row");
      if (shape) {
        preview.infoEl
          .createSpan({ cls: "ai-icon-preview" })
          .appendChild(fragment(renderIconLine(shape, first.icon, settings.iconTheme, settings.iconSize)));
      }
    }
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
      .setDesc("低于这个分数就不写图标。这是防止给每篇笔记乱贴图标的主要闸门。")
      .addSlider((s) =>
        s
          .setLimits(1, 60, 1)
          .setDynamicTooltip()
          .setValue(settings.minScore)
          .onChange(async (value) => {
            settings.minScore = value;
            await this.save();
          })
      );

    new Setting(containerEl).setName("各信号权重").setDesc("本地规则的计分权重。哪个更可信就调高哪个。");

    for (const [key, label] of WEIGHT_ROWS) {
      new Setting(containerEl).setName(label).addSlider((s) =>
        s
          .setLimits(0, 120, 1)
          .setDynamicTooltip()
          .setValue(settings.weights[key])
          .onChange(async (value) => {
            settings.weights[key] = value;
            await this.save();
          })
      );
    }
  }

  private renderBehaviour(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("写入行为").setHeading();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("写入前先预览")
      .setDesc("先列出将改动哪些文件、判定依据是什么，确认后再写入。建议保持开启。")
      .addToggle((t) =>
        t.setValue(settings.previewBeforeWrite).onChange(async (value) => {
          settings.previewBeforeWrite = value;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("覆盖已有图标")
      .setDesc("关闭时只给还没有图标的笔记添加 —— 你手动改过的图标不会被自动替换。")
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

  private renderCategories(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    new Setting(containerEl).setName(`类别（${settings.categories.length}/${CATEGORY_LIMIT}）`).setHeading();

    let idField = "";
    let nameField = "";

    new Setting(containerEl)
      .setName("新增类别")
      .setDesc(
        `还剩 ${Math.max(0, this.plugin.remainingCategorySlots)} 个名额，总上限 ${CATEGORY_LIMIT}。` +
          "新类别默认用星形图标，添加后点「换图标」挑一个。"
      )
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
          const category: Category = {
            id: idField,
            name: nameField,
            description: "自定义类别",
            icon: "star",
            keywords: [],
          };
          settings.categories.push(category);
          await this.save();
          this.refresh();
        })
      );

    // Built-in categories first, then the user's own. They are rendered in two blocks so the
    // built-ins read as a fixed vocabulary and additions read as deliberate departures from it —
    // otherwise a custom category looks like a typo in the default set.
    const builtinIds = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
    const builtin = settings.categories.filter((c) => builtinIds.has(c.id));
    const custom = settings.categories.filter((c) => !builtinIds.has(c.id));

    containerEl.createEl("h4", { cls: "ai-subhead", text: `内置类别（${builtin.length}）` });
    for (const category of builtin) this.renderCategoryRow(containerEl, category, false);

    if (custom.length > 0) {
      containerEl.createEl("h4", {
        cls: "ai-subhead",
        text: `自定义类别（${custom.length}）`,
      });
      for (const category of custom) this.renderCategoryRow(containerEl, category, true);
    }
  }

  /**
   * One category row.
   *
   * Kept to two controls — icon picker and a delete button. Keywords live behind a details panel
   * because they are the only thing here worth editing rarely, and putting a text field plus three
   * buttons on every one of 32 rows is what made the list sprawl vertically.
   */
  private renderCategoryRow(
    containerEl: HTMLElement,
    category: Category,
    isCustom: boolean
  ): void {
    const settings = this.plugin.settings;
    const set = loadedIconSet();
    const shape = set ? shapeFor(set, category.icon, settings.iconTheme) : null;

    const row = new Setting(containerEl)
      .setClass("ai-cat-row")
      .setName(category.name)
      .setDesc(isCustom ? `id: ${category.id}` : `${category.description} · id: ${category.id}`);

    if (shape) {
      row.infoEl
        .createSpan({ cls: "ai-icon-preview" })
        .appendChild(fragment(renderIconLine(shape, category.icon, settings.iconTheme, settings.iconSize)));
    }

    row.addButton((b) =>
      b
        .setButtonText("换图标")
        .setIcon("palette")
        .onClick(async () => {
          await this.plugin.pickIconForCategory(category.id);
          this.refresh();
        })
    );

    if (!isCustom) {
      row.addButton((b) =>
        b
          .setButtonText("恢复默认")
          .setIcon("rotate-ccw")
          .onClick(async () => {
            const original = cloneCategory(category.id);
            if (!original) return;
            category.icon = original.icon;
            category.keywords = [...original.keywords];
            await this.save();
            this.refresh();
          })
      );
    }

    row.addButton((b) =>
      b
        .setButtonText("删除")
        .setIcon("trash-2")
        .setWarning()
        .onClick(async () => {
          settings.categories = settings.categories.filter((c) => c.id !== category.id);
          await this.save();
          this.refresh();
        })
    );

    // Keywords behind a disclosure: present and editable, but not 32 rows of noise.
    const details = row.controlEl.createEl("details", { cls: "ai-cat-details" });
    const summary = details.createEl("summary", { cls: "ai-cat-summary" });
    summary.createSpan({ text: category.keywords.length > 0 ? `关键词 · ${category.keywords.length} 个` : "关键词" });
    summary.createSpan({ cls: "ai-cat-kws", text: category.keywords.slice(0, 8).join(" · ") });

    new Setting(details).setClass("ai-cat-kw-row").addText((t) =>
      t
        .setPlaceholder("关键词，空格分隔，例如：设计 ui ux")
        .setValue(category.keywords.join(" "))
        .onChange(async (value) => {
          category.keywords = value.toLowerCase().split(/\s+/).filter(Boolean);
          await this.save();
        })
    );
  }
}

function fragment(html: string): DocumentFragment {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const node = document.createDocumentFragment();
  while (holder.firstChild) node.appendChild(holder.firstChild);
  return node;
}

/** Default icon + keywords for a shipped category, or `null` for a user-created one. */
function cloneCategory(id: string): Category | null {
  const found = DEFAULT_CATEGORIES.find((c) => c.id === id);
  return found ? { ...found, keywords: [...found.keywords] } : null;
}