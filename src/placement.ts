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
 * mdi ships filled and outline as *paired names* — `folder` and `folder-outline` — rather than as
 * two weights of one asset. So the style is a naming convention, and the icon is stored under the
 * mXn name the user picked, not under a resolved variant.
 */
export type IconStyle = "filled" | "outline";

export const ICON_STYLES: readonly IconStyle[] = ["filled", "outline"];

export const STYLE_LABELS: Record<IconStyle, string> = {
  filled: "填充",
  outline: "线性",
};

export function isIconStyle(value: string): value is IconStyle {
  return ICON_STYLES.includes(value as IconStyle);
}

export function styleLabel(name: string): string {
  return STYLE_LABELS[name as IconStyle] ?? name;
}

/** A resolved icon: viewBox plus path data, ready to render. */
export interface IconShape {
  readonly viewBox: string;
  readonly d: string;
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
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Build the one-line SVG that goes at the top of the note. */
export function renderIconLine(
  shape: IconShape,
  icon: string,
  style: IconStyle,
  size: number
): string {
  const attrs = [
    `class="${ICON_CLASS}"`,
    `data-icon="${escapeAttr(icon)}"`,
    `data-style="${escapeAttr(style)}"`,
    `width="${size}"`,
    `height="${size}"`,
    `viewBox="${escapeAttr(shape.viewBox)}"`,
    `fill="currentColor"`,
  ].join(" ");

  return `<svg ${attrs}><path d="${escapeAttr(shape.d)}"/></svg>`;
}

export interface Placement {
  /** mXn name without the `mdi:` prefix, exactly as the user chose it. */
  readonly icon: string;
  readonly style: IconStyle;
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

  const style = ATTR_RE("data-style").exec(text)?.[1] ?? "filled";
  const height = Number(ATTR_RE("height").exec(text)?.[1]);

  return {
    icon: unescapeAttr(icon),
    style: isIconStyle(style) ? style : "filled",
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
  style: IconStyle,
  size: number
): string {
  const line = renderIconLine(shape, icon, style, size);

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