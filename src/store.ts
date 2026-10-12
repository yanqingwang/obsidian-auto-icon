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

/** One note's assigned icon, in mXn terms. */
export interface Assignment {
  readonly categoryId: string;
  /** mXn name without the `mdi:` prefix, e.g. `folder`. */
  readonly icon: string;
  readonly style: string;
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

/** Notes whose icon differs from the stored assignment, in either direction. */
export function diff(current: IconMap, next: IconMap): { added: string[]; changed: string[]; removed: string[] } {
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
  return a.icon === b.icon && a.style === b.style && a.size === b.size;
}

/** Assignments a person chose by hand, as opposed to the classifier's guesses. */
export function isManual(a: Assignment | undefined): boolean {
  return a?.manual === true;
}

/** Merge assignments in, dropping any whose file no longer exists. */
export function reconcile(map: IconMap, next: IconMap, exists: (path: string) => boolean): IconMap {
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
export function pruneMissing(map: IconMap, exists: (path: string) => boolean): IconMap {
  const out: IconMap = {};
  for (const [path, assignment] of Object.entries(map)) {
    if (exists(path)) out[path] = assignment;
  }
  return out;
}