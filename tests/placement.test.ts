import {
  applyIcon,
  detectIcon,
  ICON_CLASS,
  renderIconLine,
  stripIcon,
  type IconShape,
} from "../src/placement";

/**
 * Placement is the piece the redesign turned on, so it gets the most adversarial tests here:
 * inserting, replacing, idempotency, and — most importantly — that it never touches anything
 * except the one line it owns.
 */

/** Icon lines the plugin itself owns: a real line has width, height and data-icon. */
const countIconLines = (text: string): number =>
  (text.match(/^<svg class="auto-icon"[^\n]*data-icon="[^"]*"[^\n]*<\/svg>/gm) ?? []).length;

const shape = (body = '<path d="M0 0h256v256H0z" fill="C1" stroke="C0"/>'): IconShape => ({
  viewBox: "0 0 48 48",
  body,
  stroke: 4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});

describe("rendering the line", () => {
  it("emits a single line carrying its own identity", () => {
    const line = renderIconLine(shape(), "folder", "filled", 20);
    expect(line).not.toContain("\n");
    expect(line).toContain(`class="${ICON_CLASS}"`);
    expect(line).toContain('data-icon="folder"');
    expect(line).toContain('data-theme="filled"');
    expect(line).toContain('width="20"');
    expect(line).toContain('viewBox="0 0 48 48"');
  });

  it("escapes characters that would break the attribute", () => {
    const line = renderIconLine(shape('M0 0" onload="x'), 'a"b', "regular", 20);
    expect(line).not.toContain('onload="x"');
    expect(line).toContain("&quot;");
  });
});

describe("inserting", () => {
  it("puts the icon at the very top", () => {
    const out = applyIcon("# 标题\n\n正文", shape(), "folder", "filled", 20);
    expect(out.split("\n")[0]).toContain(`class="${ICON_CLASS}"`);
    expect(out).toContain("# 标题");
  });

  it("separates the HTML block from the markdown beneath it", () => {
    // Without the blank line the heading below would be swallowed by the HTML block.
    const out = applyIcon("# 标题", shape(), "folder", "filled", 20);
    expect(out).toBe(`${renderIconLine(shape(), "folder", "filled", 20)}\n\n# 标题`);
  });

  it("does not add a second blank line to an already-separated body", () => {
    const out = applyIcon("\n# 标题", shape(), "folder", "filled", 20);
    expect(out).toBe(`${renderIconLine(shape(), "folder", "filled", 20)}\n\n# 标题`);
  });

  it("handles an empty body", () => {
    const out = applyIcon("", shape(), "folder", "filled", 20);
    expect(detectIcon(out)).toEqual({ icon: "folder", theme: "filled", size: 20 });
  });
});

describe("replacing", () => {
  const body = `# 标题

正文内容。`;

  it("swaps the icon without touching the rest", () => {
    const once = applyIcon(body, shape(), "folder", "regular", 20);
    const twice = applyIcon(once, shape('<path d="M9 9"/>'), "bug", "filled", 28);
    expect(detectIcon(twice)).toEqual({ icon: "bug", theme: "filled", size: 28 });
    expect(twice.endsWith("# 标题\n\n正文内容。")).toBe(true);
  });

  it("never accumulates icons", () => {
    let out = body;
    for (let i = 0; i < 5; i += 1) out = applyIcon(out, shape(), `icon-${i}`, "regular", 20);
    expect(out.match(new RegExp(`class="${ICON_CLASS}"`, "g")) ?? []).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = applyIcon(body, shape(), "folder", "filled", 20);
    expect(applyIcon(once, shape(), "folder", "filled", 20)).toBe(once);
  });

  it("changes only the size when asked", () => {
    const once = applyIcon(body, shape(), "folder", "filled", 20);
    const bigger = applyIcon(once, shape(), "folder", "filled", 32);
    expect(detectIcon(bigger)?.size).toBe(32);
    // Normalising the size back must reproduce the original byte for byte, which also proves the
    // size is the *only* difference between the two documents.
    expect(bigger.replace(/(width|height)="32"/g, '$1="20"')).toBe(once);
  });
});

describe("removing", () => {
  it("leaves the body exactly as it was", () => {
    const withIcon = applyIcon("# 标题\n\n正文。", shape(), "folder", "filled", 20);
    expect(stripIcon(withIcon)).toBe("# 标题\n\n正文。");
  });

  it("is a no-op on a body with no icon", () => {
    expect(stripIcon("# 标题")).toBe("# 标题");
  });
});

describe("detection", () => {
  it("returns null when there is no icon", () => {
    expect(detectIcon("# 标题")).toBeNull();
  });

  it("ignores an unrelated svg", () => {
    expect(detectIcon('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')).toBeNull();
  });

  it("round trips through render and detect", () => {
    for (const [icon, style, size] of [
      ["folder-open", "outline", 12],
      ["chart-bar", "multi-color", 48],
      ["bookmark-simple", "two-tone", 20],
    ] as const) {
      // Detection runs over a document, so give it one rather than a bare line.
      const doc = applyIcon("# 标题", shape(), icon, style, size);
      expect(detectIcon(doc)).toEqual({ icon, theme: style, size });
    }
  });

  it("handles CRLF bodies", () => {
    const body = "# 标题\r\n\r\n正文。\r\n";
    const withIcon = applyIcon(body, shape(), "folder", "filled", 20);
    expect(detectIcon(withIcon)?.icon).toBe("folder");
    expect(stripIcon(withIcon)).toBe(body);
  });
});

describe("what it must never touch", () => {
  it("leaves fenced code alone", () => {
    const body = "# 标题\n\n```\n<svg class=\"auto-icon\" fake></svg>\n```\n";
    const out = applyIcon(body, shape(), "folder", "filled", 20);
    // The fenced copy survives untouched, and only the one real icon line was prepended.
    expect(out).toContain('<svg class="auto-icon" fake></svg>');
    expect(countIconLines(out)).toBe(1);
    expect(stripIcon(out)).toBe(body);
  });

  it("counts only fully-formed icon lines", () => {
    const body = '<svg class="auto-icon-inline"></svg>';
    expect(countIconLines(body)).toBe(0);
    expect(countIconLines(applyIcon(body, shape(), "folder", "filled", 20))).toBe(1);
  });

  it("does not rewrite an svg that merely mentions the class mid-line", () => {
    const body = "文字 <svg class=\"auto-icon-inline\"></svg> 更多文字";
    // Inline, so not at the start of a line: the icon is prepended and the text is untouched.
    const out = applyIcon(body, shape(), "folder", "filled", 20);
    expect(out).toContain(body);
    expect(countIconLines(out)).toBe(1);
    expect(stripIcon(out)).toBe(body);
  });

  it("preserves trailing whitespace-free content byte for byte", () => {
    const body = "line one\nline two\n\nline three\n";
    const once = applyIcon(body, shape(), "folder", "filled", 20);
    expect(stripIcon(once)).toBe(body);
  });
});