import {
  FuzzySuggestModal,
  Notice,
  PluginSettingTab,
  Setting,
  TFolder,
  getIconIds,
  setIcon,
  type App,
} from "obsidian";
import { cloneCategories, CATEGORY_LIMIT, type Category } from "./categories";
import type { SignalWeightsKey } from "./classifier";
import { resolveIcon, type IconRender, type UserIconSource } from "./sources";
import type { AutoIconHost } from "./settings";

/**
 * Settings.
 *
 * Two things are deliberately left as free text rather than dropdowns: the icon reference and the
 * source licence. A source the user added is a decision they made and a licence they asserted, and
 * wrapping either in a picker would hide exactly the information that matters when someone later
 * asks where an icon came from.
 *
 * Every "add" control reads its own inputs through a closure over the `TextComponent`s, never by
 * querying the container — the container holds every text field on the settings page, so a query
 * would read the scope folder instead of the new category's name.
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
    this.renderScope(containerEl);
    this.renderMatching(containerEl);
    this.renderBehaviour(containerEl);
    this.renderAi(containerEl);
    this.renderCategories(containerEl);
    this.renderSources(containerEl);
  }

  private refresh(): void {
    this.display();
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
  }

  private renderActivation(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("自动 icon").setHeading();

    new Setting(containerEl)
      .setName("怎么开始")
      .setDesc("一句话：运行命令「为当前笔记分配图标」，或用下面的按钮扫描整个 vault。")
      .addButton((b) =>
        b.setButtonText("再提示一次").onClick(async () => {
          this.plugin.showActivationHint();
          await this.save();
        })
      )
      .addButton((b) =>
        b.setButtonText("为当前笔记设置图标").onClick(async () => {
          await this.plugin.pickIconForCurrentNote();
        })
      )
      .addButton((b) =>
        b.setButtonText("清除当前笔记图标").onClick(async () => {
          await this.plugin.clearCurrentNoteIcon();
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

    new Setting(containerEl)
      .setName("各信号权重")
      .setDesc("本地规则的计分权重。哪个更可信就调高哪个。");

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
      .setDesc("关闭时只给没有图标的笔记分配 —— 手动设过的图标不会被自动覆盖。")
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

    // Each input is captured in its own closure so the add button reads *these* fields.
    let idField = "";
    let nameField = "";
    let iconField = "";

    new Setting(containerEl)
      .setName("新增类别")
      .setDesc(
        `还剩 ${Math.max(0, this.plugin.remainingCategorySlots)} 个名额，总上限 ${CATEGORY_LIMIT}。` +
          "新类别没有关键词，可在下面补上。"
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
      .addText((t) =>
        t.setPlaceholder("图标 如 lucide:rocket").onChange((v) => {
          iconField = v.trim();
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
            icon: iconField || "emoji:🏷️",
            fallbackIcon: "emoji:🏷️",
            keywords: [],
          };
          settings.categories.push(category);
          await this.save();
          this.refresh();
        })
      );

    const ctx = { lucideIds: safeIconIds(), userSources: settings.userSources };

    for (const category of settings.categories) {
      const resolved = resolveIcon(category.icon, category.fallbackIcon, ctx);

      const row = new Setting(containerEl)
        .setName(category.name)
        .setDesc(
          `${category.description} · id: ${category.id}` +
            (resolved?.usedFallback ? " · 主图标在此 Obsidian 版本不可用，正在用回退图标" : "")
        )
        .addText((t) =>
          t
            .setPlaceholder("图标")
            .setValue(category.icon)
            .onChange(async (value) => {
              category.icon = value.trim();
              await this.save();
            })
        )
        .addText((t) =>
          t
            .setPlaceholder("关键词，空格分隔")
            .setValue(category.keywords.join(" "))
            .onChange(async (value) => {
              category.keywords = value.toLowerCase().split(/\s+/).filter(Boolean);
              await this.save();
            })
        )
        .addButton((b) =>
          b.setButtonText("恢复默认").onClick(async () => {
            const original = cloneCategories().find((c) => c.id === category.id);
            if (!original) return;
            category.icon = original.icon;
            category.fallbackIcon = original.fallbackIcon;
            category.keywords = [...original.keywords];
            await this.save();
            this.refresh();
          })
        )
        .addButton((b) =>
          b.setButtonText("删除").setWarning().onClick(async () => {
            settings.categories = settings.categories.filter((c) => c.id !== category.id);
            await this.save();
            this.refresh();
          })
        );

      if (resolved) renderIcon(row.infoEl, resolved.render);
    }
  }

  private renderSources(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    new Setting(containerEl).setName("图标来源").setHeading();

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "内置来源：lucide（Obsidian 自带的 Lucide 图标集，ISC 许可，随 Obsidian 一起分发）和 emoji（Unicode 字符）。" +
        "你可以把自己的图标库加进来 —— 下面每一个就是一个来源。",
    });

    for (const source of settings.userSources) {
      const replace = (icons: Record<string, string>): void => {
        const index = settings.userSources.findIndex((s) => s.id === source.id);
        if (index < 0) return;
        settings.userSources[index] = { ...source, icons };
      };

      new Setting(containerEl)
        .setName(source.name)
        .setDesc(`id: ${source.id} · 许可：${source.license} · ${Object.keys(source.icons).length} 个图标`)
        .addButton((b) =>
          b.setButtonText("删除来源").setWarning().onClick(async () => {
            settings.userSources = settings.userSources.filter((s) => s.id !== source.id);
            await this.save();
            this.refresh();
          })
        );

      // Each existing icon gets its own row with a remove button, so one bad entry is deletable
      // without editing the whole source.
      for (const [key, glyph] of Object.entries(source.icons)) {
        new Setting(containerEl)
          .setName(key)
          .setDesc(glyph.slice(0, 40))
          .addButton((b) =>
          b.setButtonText("移除").setWarning().onClick(async () => {
            const next = { ...source.icons };
            delete next[key];
            replace(next);
            await this.save();
            this.refresh();
          })
        );
      }

      let keyField = "";
      let glyphField = "";

      new Setting(containerEl)
        .setName("向这个来源添加图标")
        .setDesc("key 用于在类别里引用，例如 rocket；内容填 emoji 字符或 SVG 片段。")
        .addText((t) =>
          t.setPlaceholder("key，例如 rocket").onChange((v) => {
            keyField = v.trim();
          })
        )
        .addText((t) =>
          t.setPlaceholder("内容，如 🚀").onChange((v) => {
            glyphField = v.trim();
          })
        )
        .addButton((b) =>
          b.setButtonText("添加").onClick(async () => {
            if (!keyField || !glyphField) {
              new Notice("Auto Icon：key 和内容都要填。");
              return;
            }
            replace({ ...source.icons, [keyField]: glyphField });
            await this.save();
            this.refresh();
          })
        );
    }

    let idField = "";
    let nameField = "";
    let licenseField = "";

    new Setting(containerEl)
      .setName("新增来源")
      .setDesc("一个来源 = 一组图标 + 一个 id + 一个许可声明。许可必填：它提醒你这些图标的授权来源。")
      .addText((t) =>
        t.setPlaceholder("来源 id（英文）").onChange((v) => {
          idField = v.trim();
        })
      )
      .addText((t) =>
        t.setPlaceholder("显示名").onChange((v) => {
          nameField = v.trim();
        })
      )
      .addText((t) =>
        t.setPlaceholder("许可，如 CC0 / MIT / 自有").onChange((v) => {
          licenseField = v.trim();
        })
      )
      .addButton((b) =>
        b.setButtonText("添加").onClick(async () => {
          if (!idField || !nameField || !licenseField) {
            new Notice("Auto Icon：来源 id、显示名、许可都要填。");
            return;
          }
          if (settings.userSources.some((s) => s.id === idField)) {
            new Notice(`Auto Icon：来源 id "${idField}" 已存在。`);
            return;
          }
          settings.userSources.push({ id: idField, name: nameField, license: licenseField, icons: {} });
          await this.save();
          this.refresh();
        })
      );
  }
}

/** Lucide names available in this build, or an empty set when the host cannot report them. */
function safeIconIds(): Set<string> {
  try {
    return new Set(getIconIds());
  } catch {
    return new Set();
  }
}

function renderIcon(el: HTMLElement, render: IconRender): void {
  el.empty();
  if (render.kind === "lucide") {
    try {
      setIcon(el, render.name);
      return;
    } catch {
      el.setText("?");
      return;
    }
  }
  el.setText(render.glyph);
}