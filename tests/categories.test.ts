import {
  assertCategoryLimit,
  CATEGORY_LIMIT,
  cloneCategories,
  DEFAULT_CATEGORIES,
} from "../src/categories";

describe("the 32 categories", () => {
  it("ships exactly the requested number", () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(32);
    expect(CATEGORY_LIMIT).toBe(32);
  });

  it("gives every category a unique id", () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every category a parseable icon reference and a fallback", () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.icon).toMatch(/^[a-z]+:/);
      expect(category.fallbackIcon).toMatch(/^[a-z]+:/);
      expect(category.icon).not.toBe(category.fallbackIcon);
    }
  });

  it("falls back to emoji, which always renders", () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.fallbackIcon.startsWith("emoji:")).toBe(true);
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