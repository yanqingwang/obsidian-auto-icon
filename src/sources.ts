/**
 * Icon sources: where an icon comes from, and how to turn one into something renderable.
 *
 * A source is a named, *declared-license* pool of icons. Three ship built-in:
 *
 * - `lucide` — Obsidian's bundled Lucide set (ISC). Available names vary by Obsidian version, so
 *   availability is checked against `getIconIds()` at runtime rather than assumed.
 * - `emoji` — Unicode emoji. No licence, no asset, renders everywhere.
 * - `file` — plain-text glyphs the user points at their own file. Used by nothing shipped here;
 *   it exists so "add your own source" means a text field, not a code change.
 *
 * Adding a source is a matter of appending to `userSources` in the plugin settings — the same code
 * path handles built-in and user sources, so a user source is not a second-class citizen.
 */

export const LUCIDE_SOURCE = "lucide";
export const EMOJI_SOURCE = "emoji";
export const FILE_SOURCE = "file";

/** Built-in source ids, which the settings UI will not let the user redefine. */
export const BUILT_IN_SOURCES: ReadonlySet<string> = new Set([LUCIDE_SOURCE, EMOJI_SOURCE, FILE_SOURCE]);

export interface IconRef {
  readonly source: string;
  readonly key: string;
}

/** A user-supplied pool of icons. `icons` maps a key to the literal glyph or SVG path to render. */
export interface UserIconSource {
  readonly id: string;
  readonly name: string;
  /** Free-text licence note. Shown in the settings UI so provenance is never lost. */
  readonly license: string;
  readonly icons: Readonly<Record<string, string>>;
}

export interface SourceContext {
  /** Lucide names this Obsidian build actually provides. */
  readonly lucideIds: ReadonlySet<string>;
  readonly userSources: readonly UserIconSource[];
}

export type IconRender =
  /** Resolve through `getIcon(name)` and inject the resulting SVG. */
  | { readonly kind: "lucide"; readonly name: string }
  /** A literal character, e.g. 📁 */
  | { readonly kind: "emoji"; readonly glyph: string }
  /** A literal string from a user source: an emoji, or an SVG path fragment. */
  | { readonly kind: "glyph"; readonly glyph: string };

export interface ResolvedIcon {
  readonly ref: IconRef;
  readonly render: IconRender;
  /** True when the primary reference did not resolve and the fallback was used. */
  readonly usedFallback: boolean;
}

/**
 * Parse `"source:key"`.
 *
 * The key may itself contain colons (an SVG path never does, but a user's label might), so only the
 * first colon separates. Returns `null` for a bare string, which is almost always a paste mistake
 * rather than an intentional reference.
 */
export function parseIconRef(value: string): IconRef | null {
  const trimmed = value.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0 || colon === trimmed.length - 1) return null;
  const source = trimmed.slice(0, colon).trim();
  const key = trimmed.slice(colon + 1).trim();
  if (source.length === 0 || key.length === 0) return null;
  return { source, key };
}

export function formatIconRef(ref: IconRef): string {
  return `${ref.source}:${ref.key}`;
}

/** Short human-readable form for the settings UI, e.g. `folder-kanban`. */
export function iconRefLabel(value: string): string {
  const ref = parseIconRef(value);
  return ref ? ref.key : value;
}

/**
 * Resolve an icon reference, falling back when the primary cannot be rendered.
 *
 * Returns `null` only when neither the primary nor the fallback resolves — the caller should treat
 * that as "this category has no usable icon" rather than guessing one.
 */
export function resolveIcon(
  primary: string,
  fallback: string | undefined,
  ctx: SourceContext
): ResolvedIcon | null {
  const direct = resolveOne(primary, ctx);
  if (direct) return { ref: direct.ref, render: direct.render, usedFallback: false };

  if (fallback && fallback !== primary) {
    const alt = resolveOne(fallback, ctx);
    if (alt) return { ref: alt.ref, render: alt.render, usedFallback: true };
  }
  return null;
}

function resolveOne(
  value: string,
  ctx: SourceContext
): { ref: IconRef; render: IconRender } | null {
  const ref = parseIconRef(value);
  if (!ref) return null;

  if (ref.source === EMOJI_SOURCE) {
    // Any glyph is valid; the key *is* the character.
    return { ref, render: { kind: "emoji", glyph: ref.key } };
  }

  if (ref.source === LUCIDE_SOURCE) {
    if (!ctx.lucideIds.has(ref.key)) return null;
    return { ref, render: { kind: "lucide", name: ref.key } };
  }

  const source = ctx.userSources.find((s) => s.id === ref.source);
  if (!source) return null;
  const glyph = source.icons[ref.key];
  if (typeof glyph !== "string" || glyph.length === 0) return null;
  return { ref, render: { kind: "glyph", glyph } };
}

/** Every reference the settings UI should offer for a category, across all sources. */
export function availableRefs(ctx: SourceContext): string[] {
  const out: string[] = [];
  for (const name of ctx.lucideIds) out.push(`${LUCIDE_SOURCE}:${name}`);
  for (const source of ctx.userSources) {
    for (const key of Object.keys(source.icons)) out.push(`${source.id}:${key}`);
  }
  return out.sort();
}