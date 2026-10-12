import type { Classification } from "./classifier";
import type { IconStyle } from "./placement";
import type { IconMap } from "./store";

/**
 * The scan pipeline, retargeted from writing files to updating the plugin's own map.
 *
 * A change is now "this note should display a different icon", not "this file needs different
 * bytes". That removes the whole class of failure a file-writing plugin carries — partial writes, a
 * crash halfway through a vault, someone else's tool disagreeing with the result — and makes the
 * whole thing undoable by deleting one key.
 */

export interface ScanInput {
  readonly path: string;
  /** What this note shows now: a stored assignment, a legacy line, or nothing. */
  readonly existing: { categoryId: string; icon: string; style: string; size: number } | null;
  readonly classification: Classification;
  readonly categoryId: string | null;
  readonly icon: string | null;
  readonly style: IconStyle;
  readonly size: number;
}

export type ChangeAction = "assign" | "replace" | "restyle" | "skip";

export interface IconChange {
  readonly path: string;
  readonly action: ChangeAction;
  readonly before: string | null;
  readonly after: string;
  readonly categoryId: string;
  readonly reasons: readonly string[];
  readonly style: IconStyle;
  readonly size: number;
}

export interface ScanPlan {
  readonly changes: IconChange[];
  readonly unchanged: number;
  readonly unmatched: number;
}

export interface PlanOptions {
  /** The map as it stands, so identical notes do not churn. */
  readonly current: IconMap;
  readonly overwriteExisting: boolean;
}

export function buildPlan(inputs: readonly ScanInput[], options: PlanOptions): ScanPlan {
  const changes: IconChange[] = [];
  let unchanged = 0;
  let unmatched = 0;

  for (const input of inputs) {
    const wanted = input.categoryId !== null && input.icon !== null;

    if (!wanted) {
      // Failing to classify never clears an icon. Not matching is not a reason to remove something
      // the user may have picked deliberately.
      if (input.existing) unchanged += 1;
      else unmatched += 1;
      continue;
    }

    const before = options.current[input.path] ?? input.existing ?? null;
    const sameIcon = before?.icon === input.icon;
    const sameStyle = before?.style === input.style;
    const sameSize = before?.size === input.size;

    if (sameIcon && sameStyle && sameSize) {
      unchanged += 1;
      continue;
    }

    if (before && !options.overwriteExisting) {
      unchanged += 1;
      continue;
    }

    changes.push({
      path: input.path,
      action: !before ? "assign" : sameIcon ? "restyle" : "replace",
      before: before ? before.icon : null,
      after: input.icon as string,
      categoryId: input.categoryId as string,
      reasons: input.classification.reasons,
      style: input.style,
      size: input.size,
    });
  }

  return { changes, unchanged, unmatched };
}

/** One-line summary for the preview and the log. */
export function describeChange(change: IconChange): string {
  switch (change.action) {
    case "assign":
      return `新增 ${change.after}`;
    case "replace":
      return `${change.before} → ${change.after}`;
    case "restyle":
      return `样式更新 ${change.after}`;
    case "skip":
      return "跳过";
  }
}