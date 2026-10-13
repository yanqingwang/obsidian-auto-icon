/**
 * Discovering the categories that actually exist in *this* vault.
 *
 * The first version shipped 32 built-in categories and scored notes against their keyword lists.
 * That approach has a structural problem: it guesses the vocabulary, so it is only ever as good as
 * a stranger's guess about how you file notes — and it guessed badly.
 *
 * A vault already contains its own answer. Tags and folder names are declarations the user made on
 * purpose, repeatedly, and their frequency is a direct read of what the taxonomy actually is. This
 * module reads those declarations out instead of inventing them.
 *
 * Frequency also does the filtering: a term used by three notes is noise, a term used by two
 * hundred is a category. That is what "筛选" means here — no hand-maintained list.
 */

export interface DiscoveredTerm {
  /** Normalised term, lower-cased, no leading `#`. */
  readonly term: string;
  /** The original spelling, kept so the UI shows what the user actually wrote. */
  readonly display: string;
  readonly count: number;
  /** Where it was found, so the preview can show why it surfaced. */
  readonly sources: ReadonlySet<"tag" | "folder">;
}

export interface DiscoveryOptions {
  /** Terms below this are dropped as noise. */
  readonly minCount: number;
  /** Hard stop on how many candidates are returned; the UI paginates. */
  readonly maxTerms: number;
  /** Never propose a term that is one of these. */
  readonly exclude: readonly string[];
  /** Prefix every folder-derived term with, so `会议/周会` cannot collide with a tag `周会`. */
  readonly folderPrefix?: string;
}

export const DEFAULT_DISCOVERY: DiscoveryOptions = {
  minCount: 3,
  maxTerms: 120,
  exclude: [],
  folderPrefix: "",
};

export interface DiscoveryInput {
  readonly path: string;
  readonly tags: readonly string[];
  /** Folders the note sits in, outermost first. */
  readonly folders: readonly string[];
}

/**
 * Normalise a raw term.
 *
 * Emoji prefixes are stripped because a lot of people file with `#📁 会议`; the emoji is decoration
 * for the eye and noise for matching. Leading `#` goes too, since Obsidian shows it but it is not
 * part of the word.
 */
export function normaliseTerm(raw: string): string {
  return (
    raw
      .trim()
      .replace(/^#+/, "")
      // Any leading pictographic run, plus variation selectors and zero-width joiners.
      .replace(
        /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+/gu,
        "",
      )
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim()
  );
}

/** Collect and rank the vault's own vocabulary. */
export function discoverTerms(
  notes: readonly DiscoveryInput[],
  options: DiscoveryOptions = DEFAULT_DISCOVERY,
): DiscoveredTerm[] {
  const found = new Map<
    string,
    { display: string; count: number; sources: Set<"tag" | "folder"> }
  >();
  const exclude = new Set(options.exclude.map(normaliseTerm).filter(Boolean));

  const bump = (
    raw: string,
    source: "tag" | "folder",
    display?: string,
  ): void => {
    const term = normaliseTerm(raw);
    if (term.length === 0) return;
    if (exclude.has(term)) return;

    const existing = found.get(term);
    if (existing) {
      existing.count += 1;
      existing.sources.add(source);
    } else {
      found.set(term, {
        display: display ?? raw.trim(),
        count: 1,
        sources: new Set([source]),
      });
    }
  };

  for (const note of notes) {
    for (const tag of note.tags) bump(tag, "tag");
    for (const folder of note.folders) bump(folder, "folder");
  }

  return [...found.entries()]
    .filter(([, v]) => v.count >= options.minCount)
    .map(([term, v]) => ({
      term,
      display: v.display,
      count: v.count,
      sources: v.sources,
    }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, options.maxTerms);
}

/** Folders a note sits in, as bare names (not full paths). */
export function folderNames(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((p) => normaliseTerm(p)).filter(Boolean);
}

/**
 * One category per discovered term.
 *
 * The term and its close variants become the category's keywords, so matching afterwards compares a
 * note's own tags against strings that genuinely occur in the vault — which is what makes it
 * accurate in a way a generic keyword list is not.
 */
export function termsToCategories(terms: readonly DiscoveredTerm[]): Array<{
  id: string;
  name: string;
  keywords: string[];
  sources: DiscoveredTerm["sources"];
}> {
  return terms.map((t) => ({
    id: `personal:${t.term}`,
    name: t.display,
    keywords: [t.term],
    sources: t.sources,
  }));
}

/** Build a stable, filesystem- and data-safe id from a term. */
export function categoryIdFor(term: string): string {
  const slug = term
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `personal-${slug || "cat"}`;
}
