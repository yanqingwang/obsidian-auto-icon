import { FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFolder, type App } from "obsidian";
import { DEFAULT_CATEGORIES, type Category } from "./categories";
import type { SignalWeightsKey } from "./classifier";
import { shapeFor } from "./iconset";
import { editCategory } from "./CategoryEditorModal";
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

    // Rows show rendered icons, which need the set. Kick the read off and re-render once it lands,
    // rather than rendering a column of placeholders on the first open.
    if (!this.plugin.set) {
      containerEl.createEl("p", { cls: "setting-item-description", text: "正在载入图标集…" });
      void this.plugin.loadIconSet().then(() => this.refresh());
    }
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
      .setDesc("点「开始」处理全部笔记，或先填一个文件夹小范围试。也可以在文件树里右键任意笔记，直接给它配图标。")
      .addButton((b) =>
        b
          .setButtonText("开始")
          .setCta()
          .onClick(async () => {
            await this.plugin.startScan();
          })
      )
      .addButton((b) =>
        b.setButtonText("用当前文件夹试试").onClick(async () => {
          await this.plugin.scanCurrentFolder();
        })
      )
      .addButton((b) =>
        b.setButtonText("再提示一次").onClick(async () => {
          this.plugin.showActivationHint();
          await this.save();
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
      .setDesc("图标在文件树里显示的大小（像素）。")
      .addSlider((s) =>
        s.setLimits(12, 32, 1).setDynamicTooltip().setValue(settings.iconSize).onChange(async (value) => {
          settings.iconSize = value;
          await this.save();
        })
      );
  }

  private renderScope(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("分配范围").setHeading();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("文件夹")
      .setDesc("留空 = 全部笔记。建议先填一个文件夹小范围试，确认效果再清空这一栏。")
      .addText((text) =>
        text.setPlaceholder("留空则全部笔记").setValue(settings.scopeFolder).onChange(async (value) => {
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
      .setDesc("低于这个分数就不配图标。这是防止给每篇笔记乱贴图标的主要闸门。")
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
      .setDesc("先列出将给哪些笔记配图标、判定依据是什么，确认后再保存。建议保持开启。")
      .addToggle((t) =>
        t.setValue(settings.previewBeforeWrite).onChange(async (value) => {
          settings.previewBeforeWrite = value;
          await this.save();
        })
      );

    new Setting(containerEl)
      .setName("覆盖已有图标")
      .setDesc("关闭时只给还没有图标的笔记配 —— 你手动改过的图标不会被自动替换。")
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
      .setDesc("默认关闭 —— 本地规则已经够用。开启后如果调用失败会自动回退到本地规则，不会中断。")
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
    new Setting(containerEl).setName(`类别（${settings.categories.length}）`).setHeading();

    const builtinIds = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
    const builtin = settings.categories.filter((c) => builtinIds.has(c.id));
    const custom = settings.categories.filter((c) => !builtinIds.has(c.id));

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "点任意一行可更换图标、编辑关键词。内置 32 个在前，你自己加的在后，没有数量上限。",
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
    const settings = this.plugin.settings;
    const set = this.plugin.set;
    const resolved = set ? shapeFor(set, category.icon, settings.iconStyle) : null;

    const row = parent.createDiv({ cls: "ai-cat" + (isCustom ? " is-custom" : "") });

    // The icon itself, rendered — not just its name. At 32 rows the picture is what makes the
    // list scannable; the mXn name is secondary and carries the technical detail.
    const thumb = row.createSpan({ cls: "ai-cat-thumb" });
    if (resolved) {
      thumb.innerHTML = renderIconLine(resolved.shape, resolved.name, settings.iconStyle, 18);
      thumb.setAttribute("title", resolved.name);
    }

    row.createSpan({ cls: "ai-cat-name", text: category.name });
    row.createSpan({ cls: "ai-cat-id", text: category.id });
    row.createSpan({ cls: "ai-cat-icon", text: category.icon });
    row.createSpan({
      cls: "ai-cat-kwcount",
      text: category.keywords.length > 0 ? `${category.keywords.length} 词` : "无关键词",
    });

    const edit = row.createEl("button", {
      cls: "ai-cat-edit",
      attr: { "aria-label": `编辑 ${category.name}` },
    });
    edit.setText("编辑");
    edit.addEventListener("click", () => {
      editCategory(this.app, this.plugin, category, isCustom, () => this.refresh());
    });
  }

  private renderAddCategory(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    let idField = "";
    let nameField = "";

    new Setting(containerEl)
      .setName("新增类别")
      .setDesc("内置 32 个，可以随意再加。加出来的会单独分组显示。")
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
