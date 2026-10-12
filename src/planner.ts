import type { Classification } from "./classifier";

/**
 * The scan pipeline: propose, show, then write.
 *
 * Planning is a separate pass from writing for the same reason it is in the sibling plugin — the
 * preview the user approves and the change that gets applied are computed from the same code, so
 * the preview cannot drift from what actually happens.
 */

export interface ScanInput {
  readonly path: string;
  /** Current `icon` frontmatter value, or null. */
  readonly currentIcon: string | null;
  readonly classification: Classification;
  /** The icon reference that will actually be written. */
  readonly icon: string | null;
}

export type ChangeAction = "assign" | "replace" | "clear" | "skip";

export interface IconChange {
  readonly path: string;
  readonly action: ChangeAction;
  readonly before: string | null;
  readonly after: string | null;
  readonly categoryId: string | null;
  readonly reasons: readonly string[];
}

export interface ScanPlan {
  readonly changes: IconChange[];
  /** Notes considered but left untouched. */
  readonly unchanged: number;
  /** Notes with no icon whose classification fell below the threshold. */
  readonly unmatched: number;
}

/**
 * Turn per-note results into the list of writes, honouring the overwrite policy.
 *
 * A classification that did not clear the bar produces a `skip`, never a `clear` — the plugin does
 * not remove icons it merely failed to replace.
 */
export function buildPlan(
  inputs: readonly ScanInput[],
  options: { overwriteExisting: boolean }
): ScanPlan {
  const changes: IconChange[] = [];
  let unchanged = 0;
  let unmatched = 0;

  for (const input of inputs) {
    const hasCategory = input.classification.categoryId !== null && input.icon !== null;

    if (!hasCategory) {
      if (input.currentIcon !== null) unchanged += 1;
      else unmatched += 1;
      continue;
    }

    if (input.currentIcon === input.icon) {
      unchanged += 1;
      continue;
    }

    if (input.currentIcon !== null && !options.overwriteExisting) {
      unchanged += 1;
      continue;
    }

    changes.push({
      path: input.path,
      action: input.currentIcon === null ? "assign" : "replace",
      before: input.currentIcon,
      after: input.icon,
      categoryId: input.classification.categoryId,
      reasons: input.classification.reasons,
    });
  }

  return { changes, unchanged, unmatched };
}

/** One-line summary for the preview and the result notice. */
export function describeChange(change: IconChange): string {
  switch (change.action) {
    case "assign":
      return `新增 ${change.after}`;
    case "replace":
      return `${change.before} → ${change.after}`;
    case "clear":
      return `移除 ${change.before}`;
    case "skip":
      return "跳过";
  }
}