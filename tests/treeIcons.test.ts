import {
  applyStylesheet,
  buildCss,
  escapePath,
  removeStylesheet,
  svgDataUri,
  STYLE_ELEMENT_ID,
  wrapCss,
} from "../src/treeIcons";
import { shapeFor, type IconSetMeta } from "../src/iconset";
import { readFileSync } from "fs";
import path from "path";

/**
 * The file-explorer icons are drawn by generated CSS rather than injected DOM, which is the whole
 * design: Obsidian re-renders the tree constantly and CSS needs no re-application.
 *
 * These tests therefore care about the *markup* — that a selector targets the right row, that a
 * data URI survives encoding, and that nothing can break out of the stylesheet.
 */

const SET = JSON.parse(readFileSync(path.join(__dirname, "..", "icons", "mdi.json"), "utf8")) as IconSetMeta;
const resolve = (icon: string, style: string) => shapeFor(SET, icon, style)?.shape ?? null;

const map = {
  "notes/a.md": { categoryId: "task", icon: "folder", style: "filled", size: 16 },
  "笔记/会议/周会.md": { categoryId: "meeting", icon: "account-group", style: "outline", size: 18 },
};

describe("path escaping", () => {
  it("escapes a double quote so it cannot close the attribute", () => {
    expect(escapePath('a"b.md')).toBe('a\\"b.md');
  });

  it("escapes backslashes", () => {
    expect(escapePath("a\\b.md")).toBe("a\\\\b.md");
  });

  it("leaves an ordinary path alone", () => {
    expect(escapePath("笔记/周会.md")).toBe("笔记/周会.md");
  });
});

describe("data URIs", () => {
  it("encodes characters that would break the URL", () => {
    // A `#` would truncate the URL at the fragment and silently drop the rest of the data.
    const uri = svgDataUri({ viewBox: "0 0 24 24", d: 'M1,1h2"#' });
    expect(uri).not.toContain("#");
    expect(uri).not.toContain("<");
    expect(uri).not.toContain(">");
    expect(uri).toContain("%23");
    expect(uri).toContain("%3C");
  });

  it("keeps the viewBox and path data recoverable", () => {
    const uri = svgDataUri({ viewBox: "0 0 24 24", d: "M10,4H4C2.89,4" });
    const svg = decodeURIComponent(uri.replace("data:image/svg+xml,", ""));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('d="M10,4H4C2.89,4"');
  });
});

describe("stylesheet generation", () => {
  it("emits one rule per note, targeting the right row", () => {
    const { css, skipped } = buildCss(map, { shapeFor: resolve });
    expect(skipped).toEqual([]);
    expect(css).toContain('.nav-file-title[data-path="notes/a.md"]');
    expect(css).toContain('.nav-file-title[data-path="笔记/会议/周会.md"]');
    expect(css.trim().split("\n")).toHaveLength(2);
  });

  it("carries the requested size", () => {
    const { css } = buildCss(map, { shapeFor: resolve });
    expect(css).toContain("width:16px;height:16px");
    expect(css).toContain("width:18px;height:18px");
  });

  it("skips a note whose icon is not in the set, and says so", () => {
    const { css, skipped } = buildCss(
      { "gone.md": { categoryId: "x", icon: "not-a-real-icon", style: "filled", size: 16 } },
      { shapeFor: resolve }
    );
    expect(css).toBe("");
    expect(skipped).toEqual(["gone.md"]);
  });

  it("handles an empty map", () => {
    expect(buildCss({}, { shapeFor: resolve }).css).toBe("");
  });

  it("cannot be escaped out of: a quote in a path is escaped", () => {
    const { css } = buildCss(
      { 'evil".md': { categoryId: "x", icon: "folder", style: "filled", size: 16 } },
      { shapeFor: resolve }
    );
    expect(css).toContain('data-path="evil\\".md"');
    // No unescaped quote may appear inside the selector.
    expect(css.split("]")[0]).not.toContain('"md');
  });

  it("inherits the text colour so icons work on light and dark themes", () => {
    const { css } = buildCss(map, { shapeFor: resolve });
    expect(css).not.toContain("color:");
  });

  it("adds a colour only when asked", () => {
    const { css } = buildCss(map, { shapeFor: resolve, color: "rgb(1,2,3)" });
    expect(css).toContain("color:rgb(1,2,3)");
  });
});

describe("wrapping", () => {
  it("emits the reset rule every icon relies on", () => {
    const wrapped = wrapCss("");
    expect(wrapped).toContain(".nav-file-title .nav-file-title-content::before");
    expect(wrapped).toContain("margin-inline-end");
  });

  it("marks itself generated so nobody hand-edits it", () => {
    expect(wrapCss("")).toContain("do not edit");
  });
});

describe("installing the stylesheet", () => {
  /**
   * A hand-rolled `document` stand-in rather than jsdom.
   *
   * jsdom is ESM-only and Jest here runs CommonJS, so pulling it in fails to load — and the only
   * DOM this module touches is `createElement`, `getElementById` and `head.appendChild`, which is
   * a few lines to fake and keeps the suite dependency-free.
   */
  function fakeDocument(): Document {
    const nodes = new Map<string, any>();
    return {
      head: { appendChild: (n: any) => nodes.set(n.id, n) },
      // `id` is assigned after creation, so `remove` has to look the node up by that id.
      createElement: () => {
        const node: any = { id: "", textContent: "" };
        node.remove = () => nodes.delete(node.id);
        return node;
      },
      getElementById: (id: string) => nodes.get(id) ?? null,
    } as unknown as Document;
  }

  it("creates one style element and reuses it", () => {
    const doc = fakeDocument();
    applyStylesheet(doc, "a{}");
    expect((doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement).textContent).toBe("a{}");
    applyStylesheet(doc, "b{}");
    expect((doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement).textContent).toBe("b{}");
  });

  it("replaces the contents rather than appending", () => {
    const doc = fakeDocument();
    applyStylesheet(doc, "a{}");
    applyStylesheet(doc, "b{}");
    expect((doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement).textContent).toBe("b{}");
  });

  it("removes cleanly", () => {
    const doc = fakeDocument();
    applyStylesheet(doc, "a{}");
    removeStylesheet(doc);
    expect(doc.getElementById(STYLE_ELEMENT_ID)).toBeNull();
  });
});
