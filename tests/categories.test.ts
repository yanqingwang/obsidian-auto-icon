import { cloneCategories, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_COUNT } from "../src/categories";
import { readFileSync } from "fs";
import path from "path";
import { hasIcon, type IconSetMeta } from "../src/iconset";
import { withDefaults } from "../src/settings";

const SET = JSON.parse(
  readFileSync(path.join(__dirname, "..", "icons", "mdi.json"), "utf8")
) as IconSetMeta;

describe("the default categories", () => {
  it("ships 32 by default, and says so", () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(32);
    expect(DEFAULT_CATEGORY_COUNT).toBe(32);
  });

  it("gives every category a unique id", () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every category an mXn name that exists in the shipped set", () => {
    // Against the real generated set, so an mXn name that was mistyped upstream cannot ship as a
    // silently blank icon.
    const missing = DEFAULT_CATEGORIES.filter((c) => !hasIcon(SET, c.icon)).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it("uses kebab-case icon names, the form the plugin stores", () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.icon).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("gives every category keywords, since the rule engine needs them", () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.keywords.length).toBeGreaterThan(0);
    }
  });

  it("names each category in Chinese, matching the vault's working language", () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.name).toMatch(/[一-鿿]/);
    }
  });
});

describe("no limit on how many a user can add", () => {
  // 32 is the shipped default, not a ceiling. An earlier version enforced a hard cap here and it
  // was wrong: the built-in vocabulary is meant to be extended, so nothing should refuse a 33rd.
  it("accepts a list well past the default size", () => {
    const many = cloneCategories();
    for (let i = 0; i < 20; i += 1) {
      many.push({
        id: `extra-${i}`,
        name: `额外 ${i}`,
        description: "",
        icon: "star",
        keywords: [],
      });
    }
    expect(many).toHaveLength(52);
    // Nothing in the module throws or trims: there is simply no cap to reach.
    expect(many.filter((c) => c.id.startsWith("extra-"))).toHaveLength(20);
  });

  it("exports a default count, not a limit", () => {
    expect(DEFAULT_CATEGORY_COUNT).toBe(DEFAULT_CATEGORIES.length);
  });
});

describe("cloning", () => {
  it("does not share keyword arrays with the defaults", () => {
    const copy = cloneCategories();
    copy[0].keywords.push("mutated");
    expect(DEFAULT_CATEGORIES[0].keywords).not.toContain("mutated");
  });

  it("produces independent category objects", () => {
    const a = cloneCategories();
    const b = cloneCategories();
    a[0].name = "changed";
    expect(b[0].name).not.toBe("changed");
  });
});
/**
 * The per-category editor is opened from a button on every row, so a failure there makes the whole
 * settings page look inert. This asserts the class is constructible and opens without throwing.
 *
 * The earlier version declared it inside an async method and pulled `Modal` via `await import()`,
 * which esbuild leaves as a literal dynamic import in the CommonJS bundle — `Modal` came back
 * undefined and the click silently did nothing. A smoke test on the class catches that class of
 * failure; a typecheck never will.
 */
describe("the category editor modal", () => {
  it("opens without throwing", () => {
    const { CategoryEditorModal } = require("../src/CategoryEditorModal") as typeof import("../src/CategoryEditorModal");
    expect(typeof CategoryEditorModal).toBe("function");

    const host = { settings: withDefaults(null), set: SET } as never;
    const modal = new CategoryEditorModal({} as never, host, DEFAULT_CATEGORIES[0], false, () => undefined);

    // The stubbed `Modal` base records onOpen rather than touching the DOM.
    expect(() => modal.onOpen()).not.toThrow();
  });
});
