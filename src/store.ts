/**
 * Icon assignments: which note gets which icon.
 *
 * The whole point of the redesign is that **notes are never modified**. The assignment lives here,
 * in the plugin's own `data.json`, keyed by note path. That makes the feature purely a display
 * concern: nothing to write, nothing to sync, nothing for another plugin to conflict over, and
 * removing the plugin leaves the vault exactly as it was.
 *
 * The cost is stated plainly: this is per-device state. It does not travel through Git, and it is
 * gone if `data.json` is deleted. That is the trade for not touching the user's files.
 */

/** One note's assigned icon, in IconPark terms. */
export interface Assignment {
  readonly categoryId: string;
  /** IconPark name without the `icon-park:` prefix, e.g. `folder-open`. */
  readonly icon: string;
  readonly theme: string;
  readonly size: number;
  /**
   * True when a person chose this icon rather than the classifier.
   *
   * This is what makes "the classifier got it wrong" recoverable: a manual pick is a deliberate
   * decision, so a later bulk scan will not silently replace it, and the preview says so instead.
   */
  readonly manual?: boolean;
}

export type IconMap = Record<string, Assignment>;

export function emptyMap(): IconMap {
  return {};
}

/**
 * Coerce whatever is in `data.json` into a usable map.
 *
 * The stored map is per-device state that survives upgrades, so its shape has to be treated as
 * untrusted input. Version 0.2.0 stored `style` where 0.3.0 stores `theme`; a blind cast would read
 * `undefined` for the theme and silently repaint every hand-picked icon instead of reporting
 * anything. Entries that cannot be understood are dropped rather than propagated, because a
 * half-valid assignment is worse than none: it draws the wrong icon with no way to tell why.
 */
export function normaliseAssignments(raw: unknown): IconMap {
  const out: IconMap = {};
  if (typeof raw !== "object" || raw === null) return out;

  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;

    const categoryId = entry.categoryId;
    const icon = entry.icon;
    if (typeof categoryId !== "string" || typeof icon !== "string" || icon.length === 0) continue;

    const size = Number(entry.size);
    out[path] = {
      categoryId,
      icon,
      theme: normaliseTheme(entry.theme ?? entry.style),
      size: Number.isFinite(size) && size > 0 ? size : 16,
      // Preserved verbatim: a manual pick is a deliberate decision and must survive the upgrade,
      // or the first bulk scan after updating would overwrite the user's own choice.
      ...(entry.manual === true ? { manual: true } : {}),
    };
  }
  return out;
}

const THEMES = ["outline", "filled", "two-tone", "duotone"];

function normaliseTheme(value: unknown): string {
  return typeof value === "string" && THEMES.includes(value) ? value : "outline";
}

/** Notes whose icon differs from the stored assignment, in either direction. */
export function diff(
  current: IconMap,
  next: IconMap,
): { added: string[]; changed: string[]; removed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [path, assignment] of Object.entries(next)) {
    const before = current[path];
    if (!before) added.push(path);
    else if (!sameAssignment(before, assignment)) changed.push(path);
  }
  for (const path of Object.keys(current)) {
    if (!next[path]) removed.push(path);
  }
  return { added, changed, removed };
}

export function sameAssignment(a: Assignment, b: Assignment): boolean {
  return a.icon === b.icon && a.theme === b.theme && a.size === b.size;
}

/** Assignments a person chose by hand, as opposed to the classifier's guesses. */
export function isManual(a: Assignment | undefined): boolean {
  return a?.manual === true;
}

/** Merge assignments in, dropping any whose file no longer exists. */
export function reconcile(
  map: IconMap,
  next: IconMap,
  exists: (path: string) => boolean,
): IconMap {
  const out: IconMap = {};
  for (const [path, assignment] of Object.entries(next)) {
    if (exists(path)) out[path] = assignment;
  }
  return out;
}

/**
 * Drop assignments for notes that are gone.
 *
 * Without this, a renamed or deleted note leaves a rule in the generated CSS forever, and the map
 * grows without bound. Paths are matched exactly, so this cannot drop a live note by accident.
 */
export function pruneMissing(
  map: IconMap,
  exists: (path: string) => boolean,
): IconMap {
  const out: IconMap = {};
  for (const [path, assignment] of Object.entries(map)) {
    if (exists(path)) out[path] = assignment;
  }
  return out;
}
