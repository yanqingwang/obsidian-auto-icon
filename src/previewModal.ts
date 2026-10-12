import { App, Modal } from "obsidian";
import { iconRefLabel } from "./sources";
import type { ScanPlan } from "./planner";

/**
 * Preview of proposed icon assignments.
 *
 * Shows the before → after per note plus *why* each was chosen, because the single most likely
 * complaint about an auto-tagging plugin is "why did it think this was a 会议?" — and the honest
 * answer is usually a tag the user forgot was there. Showing the evidence makes that answerable
 * without reading the plugin's source.
 */

export interface PreviewRequest {
  readonly plan: ScanPlan;
  readonly scopeDescription: string;
  readonly matchedCount: number;
  readonly consideredCount: number;
  readonly aiEnabled: boolean;
}

const MAX_RENDERED = 300;

export class IconPreviewModal extends Modal {
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
    const replace = plan.changes.length - assign;

    contentEl.createEl("p", {
      cls: "ai-summary",
      text: `将修改 ${plan.changes.length} 个文件（新增 ${assign} · 覆盖 ${replace}） · 范围：${this.request.scopeDescription}`,
    });
    contentEl.createEl("p", {
      cls: "ai-muted",
      text: `共扫描 ${this.request.consideredCount} 个笔记，命中 ${this.request.matchedCount} 个；${plan.unchanged} 个保持不变，${plan.unmatched} 个未匹配到类别（不会写入图标）。`,
    });

    if (this.request.aiEnabled) {
      contentEl.createEl("p", {
        cls: "ai-muted",
        text: "AI 分类已启用。请求会发送笔记标题、标签与正文节选到你在设置里配置的接口。",
      });
    }

    const list = contentEl.createDiv({ cls: "ai-files" });
    const shown = plan.changes.slice(0, MAX_RENDERED);
    for (const change of shown) {
      const row = list.createDiv({ cls: "ai-row" });
      row.createSpan({ cls: "ai-path", text: change.path });
      const values = row.createSpan({ cls: "ai-values" });
      if (change.before) {
        values.createEl("code", { cls: "ai-before", text: iconRefLabel(change.before) });
        values.createSpan({ cls: "ai-arrow", text: "→" });
      }
      values.createEl("code", { cls: "ai-after", text: change.after ? iconRefLabel(change.after) : "—" });
      if (change.reasons.length > 0) {
        row.createDiv({ cls: "ai-reasons", text: change.reasons.join("；") });
      }
    }
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

  onClose(): void {
    this.contentEl.empty();
  }
}