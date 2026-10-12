import {
  assertCategoryLimit,
  CATEGORY_LIMIT,
  cloneCategories,
  DEFAULT_CATEGORIES,
} from "../src/categories";
import { readFileSync } from "fs";
import path from "path";
import { hasIcon, type IconSetMeta } from "../src/iconset";

const SET = JSON.parse(
  readFileSync(path.join(__dirname, "..", "icons", "iconpark.json"), "utf8")
) as IconSetMeta;

describe("the 32 categories", () => {
  it("ships exactly the requested number", () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(32);
    expect(CATEGORY_LIMIT).toBe(32);
  });

  it("gives every category a unique id", () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every category an icon that exists in the shipped set", () => {
    // The strongest possible check: against the real generated set, so a name that was renamed or
    // mistyped upstream cannot ship as a silently blank icon.
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

describe("the 32 cap", () => {
  const full = cloneCategories();

  it("accepts a list at the limit", () => {
    expect(() => assertCategoryLimit(full)).not.toThrow();
  });

  it("rejects a list past the limit", () => {
    const extra = cloneCategories();
    extra.push({ id: "extra", name: "额外", description: "", icon: "emoji:➕", fallbackIcon: "emoji:➕", keywords: [] });
    expect(() => assertCategoryLimit(extra)).toThrow(/超过上限 32/);
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