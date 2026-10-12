import { App, Modal } from "obsidian";
import { shapeFor } from "./iconset";
import { styleLabel, type IconStyle } from "./placement";
import type { ScanPlan } from "./planner";

/**
 * Preview of proposed icon assignments.
 *
 * Each row shows the icon **as it will look in the file tree**, next to the note path and the reason
 * it was chosen. The reasons matter most: the default complaint about an auto-tagging plugin is
 * "why did it think this was a meeting?", and the honest answer is usually a tag the user forgot was
 * there. Showing it makes that answerable without reading the plugin.
 *
 * Nothing is saved until this is accepted.
 */

export interface PreviewRequest {
  readonly plan: ScanPlan;
  readonly scopeDescription: string;
  readonly matched: number;
  readonly considered: number;
  readonly aiEnabled: boolean;
  readonly iconSet: import("./iconset").IconSetMeta | null;
  readonly iconStyle: IconStyle;
}

const MAX_RENDERED = 300;

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
    this.titleEl.setText("Auto Icon — 即将分配的图标");

    const assign = plan.changes.filter((c) => c.action === "assign").length;
    const rest = plan.changes.length - assign;

    contentEl.createEl("p", {
      cls: "ai-summary",
      text: `将给 ${plan.changes.length} 个笔记分配图标（新增 ${assign} · 更新 ${rest}） · 样式：${styleLabel(this.request.iconStyle)} · 范围：${this.request.scopeDescription}`,
    });
    contentEl.createEl("p", {
      cls: "ai-muted",
      text: `扫描 ${this.request.considered} 个笔记，命中 ${this.request.matched} 个；${plan.unchanged} 个保持不变，${plan.unmatched} 个未匹配到类别（不会分配，也不会清除已有图标）。笔记文件本身不会被修改。`,
    });

    if (plan.protectedManual.length > 0) {
      contentEl.createEl("p", {
        cls: "ai-muted",
        text: `其中 ${plan.protectedManual.length} 个笔记的图标是你手动选的，已跳过，不会被自动结果覆盖。`,
      });
    }

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
      list.createEl("p", { cls: "ai-muted", text: `… 另有 ${plan.changes.length - shown.length} 个笔记未列出。` });
    }

    const buttons = contentEl.createDiv({ cls: "ai-buttons" });
    const cancel = buttons.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());

    const apply = buttons.createEl("button", {
      text: plan.changes.length === 0 ? "关闭" : `分配 ${plan.changes.length} 个图标`,
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

    const set = this.request.iconSet;
    const resolved = set ? shapeFor(set, change.after, change.style) : null;
    if (resolved) {
      row.createSpan({ cls: "ai-row-icon" }).innerHTML =
        `<svg viewBox="${resolved.shape.viewBox}" width="18" height="18" fill="currentColor"><path d="${resolved.shape.d}"/></svg>`;
    }

    const head = row.createDiv({ cls: "ai-row-head" });
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