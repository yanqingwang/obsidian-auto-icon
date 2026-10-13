import type { Category } from "./categories";

/**
 * Turning a note into a category.
 *
 * `NoteClassifier` is the seam that lets the plugin stay standalone today and gain an AI classifier
 * later without rewriting the pipeline. `RuleClassifier` — local, zero-cost, offline — is the
 * default. `AiClassifier` implements the same interface and is opt-in.
 *
 * The rule engine is pure: it takes already-extracted signals, never an Obsidian object, so the
 * scoring behaviour is unit-testable without a vault.
 */

export interface NoteSignals {
  /** Vault-relative path, e.g. `work/2026/plan.md`. */
  readonly path: string;
  /** File name without the `.md` extension. */
  readonly basename: string;
  /** Frontmatter tags, lower-cased, without the leading `#`. */
  readonly tags: readonly string[];
  /** First-level headings in the body, lower-cased. */
  readonly headings: readonly string[];
  /** A short slice of body text used for weak keyword evidence. */
  readonly excerpt: string;
  /** An explicit `type` / `category` / `icon-category` frontmatter value, if any. */
  readonly declared: string | null;
}

export interface Classification {
  readonly categoryId: string | null;
  /** Score of the winner. `0` means nothing matched. */
  readonly score: number;
  /** Score of the runner-up; 0 when there is none. Useful for a confidence readout. */
  readonly runnerUp: number;
  /** Human-readable evidence, e.g. `tags: task`. Shown in the preview. */
  readonly reasons: readonly string[];
}

export interface ClassifyOptions {
  /** Minimum score required to assign an icon. Guards against churning every note. */
  readonly minScore: number;
  /** Per-field weights, kept overridable so a vault can lean on folders over tags. */
  readonly weights?: Partial<SignalWeights>;
}

export interface SignalWeights {
  declared: number;
  tagExact: number;
  tagKeyword: number;
  folder: number;
  basename: number;
  heading: number;
  excerpt: number;
}

export const DEFAULT_WEIGHTS: SignalWeights = {
  declared: 100,
  tagExact: 10,
  tagKeyword: 5,
  folder: 6,
  basename: 4,
  heading: 3,
  excerpt: 1,
};

/** Key names of `SignalWeights`, for driving settings sliders. */
export type SignalWeightsKey = keyof SignalWeights;

export interface NoteClassifier {
  readonly id: string;
  classify(
    signals: NoteSignals,
    categories: readonly Category[],
  ): Promise<Classification>;
}

/* ------------------------------------------------------------------ *
 * Local rule engine
 * ------------------------------------------------------------------ */

interface Candidate {
  score: number;
  reasons: string[];
}

/**
 * Score every category against every signal and return the best.
 *
 * Substring matching is used for tags/headings/excerpts because Chinese notes rarely use word
 * boundaries, and because an English tag like `bug-report` should still hit `bug`. Exact matches on
 * a category id or name always outscore an incidental substring hit.
 */
export function classifyByRules(
  signals: NoteSignals,
  categories: readonly Category[],
  opts: ClassifyOptions,
): Classification {
  const w = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const scores = new Map<string, Candidate>();

  const bump = (id: string, amount: number, reason: string): void => {
    const current = scores.get(id);
    if (current) {
      current.score += amount;
      current.reasons.push(reason);
    } else {
      scores.set(id, { score: amount, reasons: [reason] });
    }
  };

  // An explicit declaration short-circuits everything else.
  if (signals.declared) {
    const explicit = findByIdOrName(categories, signals.declared);
    if (explicit) {
      return {
        categoryId: explicit.id,
        score: w.declared,
        runnerUp: 0,
        reasons: [`声明 type=${signals.declared}`],
      };
    }
  }

  const folderText = folderOf(signals.path);
  const base = signals.basename.toLowerCase();

  for (const category of categories) {
    const idKey = category.id.toLowerCase();
    const nameKey = category.name.toLowerCase();

    for (const tag of signals.tags) {
      if (tag === idKey || tag === nameKey)
        bump(category.id, w.tagExact, `标签 #${tag}`);
      else
        for (const kw of category.keywords)
          if (tag.includes(kw))
            bump(category.id, w.tagKeyword, `标签 #${tag} ~ ${kw}`);
    }

    // Folder and filename are matched against keywords as well as the category's own id and name —
    // a note named `2026-budget.md` has to be able to reach the `finance` category, whose keyword is
    // "budget". One hit per field, so a folder called `contract/archive` still counts once.
    const folderMatch = firstMatch(folderText, category, idKey, nameKey);
    if (folderMatch)
      bump(category.id, w.folder, `文件夹 ${folderText} ~ ${folderMatch}`);

    const baseMatch = firstMatch(base, category, idKey, nameKey);
    if (baseMatch)
      bump(
        category.id,
        w.basename,
        `文件名 ${signals.basename} ~ ${baseMatch}`,
      );

    // At most one hit per category per text field. Without this, a long note mentioning
    // "bug issue error defect 故障 异常" would out-score an explicit `#task` tag purely by length.
    let headingHit = false;
    let excerptHit = false;
    for (const keyword of category.keywords) {
      if (!headingHit && signals.headings.some((h) => h.includes(keyword))) {
        bump(category.id, w.heading, `标题 ~ ${keyword}`);
        headingHit = true;
      }
      if (!excerptHit && signals.excerpt.includes(keyword)) {
        bump(category.id, w.excerpt, `正文 ~ ${keyword}`);
        excerptHit = true;
      }
      if (headingHit && excerptHit) break;
    }
  }

  const ranked = [...scores.entries()].sort(
    (a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]),
  );
  const best = ranked[0];
  const second = ranked[1];

  if (!best || best[1].score < opts.minScore) {
    return {
      categoryId: null,
      score: best?.[1].score ?? 0,
      runnerUp: 0,
      reasons: [],
    };
  }

  return {
    categoryId: best[0],
    score: best[1].score,
    runnerUp: second?.[1].score ?? 0,
    reasons: dedupe(best[1].reasons).slice(0, 4),
  };
}

/** First term that makes `text` match this category — its id, its name, or a keyword. */
function firstMatch(
  text: string,
  category: Category,
  idKey: string,
  nameKey: string,
): string | null {
  if (text.length === 0) return null;
  if (text.includes(idKey)) return idKey;
  if (text.includes(nameKey)) return nameKey;
  for (const keyword of category.keywords) {
    if (keyword.length > 0 && text.includes(keyword)) return keyword;
  }
  return null;
}

function findByIdOrName(
  categories: readonly Category[],
  needle: string,
): Category | undefined {
  const key = needle.trim().toLowerCase();
  return categories.find(
    (c) => c.id.toLowerCase() === key || c.name.toLowerCase() === key,
  );
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash).toLowerCase();
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export class RuleClassifier implements NoteClassifier {
  readonly id = "rules";

  constructor(private readonly options: ClassifyOptions) {}

  classify(
    signals: NoteSignals,
    categories: readonly Category[],
  ): Promise<Classification> {
    return Promise.resolve(classifyByRules(signals, categories, this.options));
  }
}

/* ------------------------------------------------------------------ *
 * Signal extraction (pure, operates on strings)
 * ------------------------------------------------------------------ */

/** Frontmatter keys that override classification outright. */
export const DECLARED_KEYS = [
  "auto-icon-category",
  "type",
  "category",
  "kind",
] as const;

export interface RawNote {
  readonly path: string;
  readonly frontmatter: Record<string, unknown> | null;
  readonly body: string;
}

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/gm;

/** Build classifier signals from a note's path, frontmatter and body. */
export function extractSignals(
  note: RawNote,
  excerptChars = 1500,
): NoteSignals {
  const fm = note.frontmatter ?? {};
  return {
    path: note.path,
    basename: basenameOf(note.path),
    tags: readTags(fm),
    headings: readHeadings(note.body),
    excerpt: note.body.slice(0, excerptChars).toLowerCase(),
    declared: readDeclared(fm),
  };
}

export function basenameOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}

function readTags(fm: Record<string, unknown>): string[] {
  const raw = fm["tags"] ?? fm["tag"];
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,\s]+/)
      : [];
  return list
    .map((t) => String(t).trim().replace(/^#/, "").toLowerCase())
    .filter((t) => t.length > 0);
}

function readHeadings(body: string): string[] {
  const out: string[] = [];
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(body)) !== null && out.length < 12) {
    out.push(m[2].toLowerCase());
  }
  return out;
}

function readDeclared(fm: Record<string, unknown>): string | null {
  for (const key of DECLARED_KEYS) {
    const value = fm[key];
    if (typeof value === "string" && value.trim().length > 0)
      return value.trim();
  }
  return null;
}
