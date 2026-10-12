import { App, Modal } from "obsidian";
import type { ScanPlan } from "./planner";
import { renderIconLine, THEMES } from "./placement";
import type { IconThemeName } from "./placement";

/**
 * Preview of proposed icon changes.
 *
 * Shows the actual rendered icon next to each note, plus *why* it was chosen — because the single
 * most likely complaint about an auto-tagging plugin is "why did it think this was a meeting?", and
 * the honest answer is usually a tag the user forgot was there. Showing the evidence makes that
 * answerable without reading the plugin's source.
 */

export interface PreviewRequest {
  readonly plan: ScanPlan;
  readonly scopeDescription: string;
  readonly matched: number;
  readonly considered: number;
  readonly aiEnabled: boolean;
  readonly theme: IconThemeName;
}

const MAX_RENDERED = 300;

function themeLabel(name: IconThemeName): string {
  return THEMES.find((t) => t.name === name)?.label ?? name;
}

export class PreviewModal extends Modal {
  private readonly request: PreviewRequest;
  private readonly onConfirm: () => void;

  constructor(app: App, request: PreviewRequest, onConfirm: () => void) {
    super(app);
    this.request = request;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { plan } = this.request;
    const { contentEl } = this;
    this.titleEl.setText("Auto Icon — 即将写入的图标");

    const assign = plan.changes.filter((c) => c.action === "assign").length;
    const rest = plan.changes.length - assign;

    contentEl.createEl("p", {
      cls: "ai-summary",
      text: `将修改 ${plan.changes.length} 个文件（新增 ${assign} · 更新 ${rest}） · 样式：${themeLabel(this.request.theme)} · 范围：${this.request.scopeDescription}`,
    });
    contentEl.createEl("p", {
      cls: "ai-muted",
      text: `扫描 ${this.request.considered} 个笔记，命中 ${this.request.matched} 个；${plan.unchanged} 个保持不变，${plan.unmatched} 个未匹配到类别（不会写入，也不会清除已有图标）。`,
    });

    if (this.request.aiEnabled) {
      contentEl.createEl("p", {
        cls: "ai-muted",
        text: "AI 分类已启用。请求会发送笔记标题、标签与正文节选到你在设置里配置的接口。",
      });
    }

    const list = contentEl.createDiv({ cls: "ai-files" });
    const shown = plan.changes.slice(0, MAX_RENDERED);
    for (const change of shown) this.renderRow(list, change);
    if (plan.changes.length > shown.length) {
      list.createEl("p", {
        cls: "ai-muted",
        text: `… 另有 ${plan.changes.length - shown.length} 个文件未列出。`,
      });
    }

    const buttons = contentEl.createDiv({ cls: "ai-buttons" });
    const cancel = buttons.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());

    const apply = buttons.createEl("button", {
      text: plan.changes.length === 0 ? "关闭" : `写入 ${plan.changes.length} 个文件`,
      cls: "mod-cta",
    });
    apply.addEventListener("click", () => {
      this.close();
      if (plan.changes.length > 0) this.onConfirm();
    });
    apply.focus();
  }

  private renderRow(parent: HTMLElement, change: ScanPlan["changes"][number]): void {
    const row = parent.createDiv({ cls: "ai-row" });

    const head = row.createDiv({ cls: "ai-row-head" });
    if (change.shape) {
      head.createDiv({ cls: "ai-icon-preview" }).innerHTML = renderIconLine(
        change.shape,
        change.after ?? "",
        change.theme,
        change.size
      );
    }
    head.createSpan({ cls: "ai-path", text: change.path });
    if (change.before && change.action === "replace") {
      head.createSpan({ cls: "ai-was", text: `原 ${change.before}` });
    }

    if (change.reasons.length > 0) {
      row.createDiv({ cls: "ai-reasons", text: change.reasons.join("；") });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}