import type { Classification } from "./classifier";
import type { IconShape, IconThemeName, Placement } from "./placement";

/**
 * The scan pipeline, retargeted from frontmatter to the top of the note.
 *
 * "What icon does this note already have?" is now a question about the note *body* rather than its
 * metadata, so the comparison that decides assign-vs-replace compares the icon identity rather than
 * a stored string. An identical icon is not a change, and a note whose icon merely differs in size
 * is not either — both would produce a pointless rewrite on every run.
 */

export interface ScanInput {
  readonly path: string;
  /** Icon already present at the top of the body, or `null`. */
  readonly current: Placement | null;
  readonly classification: Classification;
  readonly categoryId: string | null;
  readonly icon: string | null;
  /** Shape resolved for `icon`, needed only when the change will actually be written. */
  readonly shape: IconShape | null;
  readonly theme: IconThemeName;
  readonly size: number;
}

export type ChangeAction = "assign" | "replace" | "retarget" | "clear" | "skip";

export interface IconChange {
  readonly path: string;
  readonly action: ChangeAction;
  readonly before: string | null;
  readonly after: string | null;
  readonly categoryId: string | null;
  readonly reasons: readonly string[];
  /** Present on every change that writes. */
  readonly shape: IconShape | null;
  readonly theme: IconThemeName;
  readonly size: number;
}

export interface ScanPlan {
  readonly changes: IconChange[];
  readonly unchanged: number;
  readonly unmatched: number;
}

export function buildPlan(inputs: readonly ScanInput[], options: { overwriteExisting: boolean }): ScanPlan {
  const changes: IconChange[] = [];
  let unchanged = 0;
  let unmatched = 0;

  for (const input of inputs) {
    const wantsIcon = input.categoryId !== null && input.icon !== null;

    if (!wantsIcon) {
      // A note we failed to classify keeps whatever icon it already has. Failing to match is not a
      // reason to remove something.
      if (input.current) unchanged += 1;
      else unmatched += 1;
      continue;
    }

    const sameIcon = input.current?.icon === input.icon;
    const sameTheme = input.current?.theme === input.theme;
    const sameSize = input.current?.size === input.size;

    if (sameIcon && sameTheme && sameSize) {
      unchanged += 1;
      continue;
    }

    if (input.current && !options.overwriteExisting) {
      unchanged += 1;
      continue;
    }

    const action: ChangeAction = !input.current ? "assign" : sameIcon ? "retarget" : "replace";

    changes.push({
      path: input.path,
      action,
      before: input.current ? describe(input.current) : null,
      after: input.icon,
      categoryId: input.categoryId,
      reasons: input.classification.reasons,
      shape: input.shape,
      theme: input.theme,
      size: input.size,
    });
  }

  return { changes, unchanged, unmatched };
}

/** Short label for the preview and the log. */
export function describeChange(change: IconChange): string {
  switch (change.action) {
    case "assign":
      return `新增 ${change.after}`;
    case "replace":
      return `${change.before} → ${change.after}`;
    case "retarget":
      return `样式更新 ${change.before} → ${change.after}`;
    case "clear":
      return `移除 ${change.before}`;
    case "skip":
      return "跳过";
  }
}

function describe(p: Placement): string {
  return `${p.icon}·${p.theme}`;
}