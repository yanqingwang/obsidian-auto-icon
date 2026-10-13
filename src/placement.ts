/**
 * Placing the icon at the top of the file.
 *
 * This is the part that changed after the first version wrote `icon:` into frontmatter. Frontmatter
 * is metadata — it is out of the way, which is exactly why it read as wrong: the icon became
 * something you could not see without opening the properties panel, and the note itself still looked
 * identical to every other note.
 *
 * So the icon now lives at the top of the note body as a single self-describing line:
 *
 * ```html
 * <svg class="auto-icon" data-icon="folder" data-style="outline" …><path …/></svg>
 *
 * # 项目说明
 * ```
 *
 * Three properties this shape buys:
 *
 * - **Visible.** Obsidian renders inline HTML in reading view; a stylesheet handles edit mode.
 * - **Reversible.** `data-icon` / `data-style` carry the identity, so a re-run replaces rather than
 *   appends, and detection never has to re-parse path data.
 * - **Non-destructive.** Everything outside that one line is untouched, and the blank line after it
 *   keeps the markdown beneath from being swallowed by the HTML block.
 *
 * All pure string work, so placement is testable without a vault.
 */

export const ICON_CLASS = "auto-icon";

/**
 * IconPark's themes are four colour mappings over one static drawing, not four variants of it.
 * So a theme is a choice of colours rather than a choice of asset, and every stored icon supports
 * all four at no extra cost.
 */
export type IconThemeName = "outline" | "filled" | "two-tone" | "duotone";

export const ICON_THEMES: readonly IconThemeName[] = [
  "outline",
  "filled",
  "two-tone",
  "duotone",
];

export function isIconTheme(value: string): value is IconThemeName {
  return ICON_THEMES.includes(value as IconThemeName);
}

export function themeLabel(name: string): string {
  return THEME_LABELS[name as IconThemeName] ?? name;
}

/** Kept here so the picker and the settings page agree without importing the icon set. */
export const THEME_LABELS: Record<IconThemeName, string> = {
  outline: "线性",
  filled: "填充",
  "two-tone": "双色",
  duotone: "多彩",
};

/** A resolved icon: inner markup with real colours already applied. */
export interface IconShape {
  readonly viewBox: string;
  readonly body: string;
  /** Hoisted off every path onto the root <svg>, since these attributes inherit. */
  readonly stroke: number;
  readonly strokeLinecap: string;
  readonly strokeLinejoin: string;
}

/**
 * Matches exactly one icon line this plugin wrote.
 *
 * Two deliberate choices:
 *
 * - `data-icon="..."` is **required**, not optional. Without it a hand-written or illustrative
 *   `<svg class="auto-icon">` — including one inside a fenced code block in this plugin's own
 *   documentation — would be treated as a real icon and silently deleted by a scan.
 * - The trailing newline plus an optional blank line are part of the match. That blank line is what
 *   separates the HTML block from the markdown beneath it, so it belongs to the icon rather than to
 *   the note, and including it is what lets `stripIcon` restore a body byte for byte instead of
 *   leaving a stray blank line behind.
 */
const ICON_LINE_RE =
  /^<svg class="auto-icon"(?=[^\n]*\bdata-icon="[^"]*")[^\n]*<\/svg>[ \t]*\r?\n(?:[ \t]*\r?\n)?/gm;

const ATTR_RE = (name: string): RegExp => new RegExp(`\\b${name}="([^"]*)"`);

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Build the one-line SVG that goes at the top of the note. */
export function renderIconLine(
  shape: IconShape,
  icon: string,
  theme: IconThemeName,
  size: number,
): string {
  const attrs = [
    `class="${ICON_CLASS}"`,
    `data-icon="${escapeAttr(icon)}"`,
    `data-theme="${escapeAttr(theme)}"`,
    `width="${size}"`,
    `height="${size}"`,
    `viewBox="${escapeAttr(shape.viewBox)}"`,
    `fill="none"`,
    `stroke-width="${shape.stroke}"`,
    `stroke-linecap="${escapeAttr(shape.strokeLinecap)}"`,
    `stroke-linejoin="${escapeAttr(shape.strokeLinejoin)}"`,
  ].join(" ");

  return `<svg ${attrs}>${shape.body}</svg>`;
}

export interface Placement {
  /** IconPark name without the `icon-park:` prefix, exactly as the user chose it. */
  readonly icon: string;
  readonly theme: IconThemeName;
  readonly size: number;
}

/** Read an existing icon out of a body, or `null` when there is none. */
export function detectIcon(body: string): Placement | null {
  ICON_LINE_RE.lastIndex = 0;
  const line = ICON_LINE_RE.exec(body);
  if (!line) return null;

  const text = line[0];
  const icon = ATTR_RE("data-icon").exec(text)?.[1];
  if (!icon) return null;

  const theme = ATTR_RE("data-theme").exec(text)?.[1] ?? "outline";
  const height = Number(ATTR_RE("height").exec(text)?.[1]);

  return {
    icon: unescapeAttr(icon),
    theme: isIconTheme(theme) ? theme : "outline",
    size: Number.isFinite(height) && height > 0 ? height : 20,
  };
}

/** Remove the icon line, leaving the rest of the body exactly as it was. */
export function stripIcon(body: string): string {
  ICON_LINE_RE.lastIndex = 0;
  return body.replace(ICON_LINE_RE, "");
}

/**
 * Put the icon at the top of the body, replacing any existing one.
 *
 * When an icon is already present the surrounding text is left completely alone — the point is that
 * re-running the plugin never rearranges somebody's notes. Only a first insertion adds the blank
 * line that separates the HTML block from the markdown beneath it.
 */
export function applyIcon(
  body: string,
  shape: IconShape,
  icon: string,
  theme: IconThemeName,
  size: number,
): string {
  const line = renderIconLine(shape, icon, theme, size);

  if (detectIcon(body)) {
    // A blank separator line belongs to the icon, so the replacement re-emits it — otherwise
    // running the plugin twice would leave an extra blank line above the heading.
    ICON_LINE_RE.lastIndex = 0;
    const separator = ICON_LINE_RE.test(body) ? "\n\n" : "\n";
    ICON_LINE_RE.lastIndex = 0;
    return body.replace(ICON_LINE_RE, `${line}${separator}`);
  }

  const prefix = line + "\n";
  // Already blank-separated, or already starting with an HTML block: no extra blank line needed.
  if (/^\s*$/.test(body) || /^\n/.test(body)) return prefix + body;
  return `${prefix}\n${body}`;
}
