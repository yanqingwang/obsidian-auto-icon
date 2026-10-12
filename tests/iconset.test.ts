import { readFileSync } from "fs";
import path from "path";
import {
  hasIcon,
  iconNames,
  loadedIconSet,
  loadIconSet,
  mxnName,
  resolveName,
  searchIcons,
  setIconSetLoader,
  shapeFor,
  type IconSetMeta,
} from "../src/iconset";
import { DEFAULT_CATEGORIES } from "../src/categories";

/**
 * These read the *real* generated `icons/mdi.json`, not a fixture. The plugin's promise is that the
 * whole set ships locally in mXn naming, so "every default category resolves" is a claim about the
 * shipped artefact and has to be tested against it.
 */

const SET = JSON.parse(readFileSync(path.join(__dirname, "..", "icons", "mdi.json"), "utf8")) as IconSetMeta;

beforeEach(() => setIconSetLoader(null));

describe("the shipped set", () => {
  it("is Material Design Icons, Apache-2.0, in mXn naming", () => {
    expect(SET.source).toBe("Material Design Icons");
    expect(SET.prefix).toBe("mdi");
    expect(SET.license).toBe("Apache-2.0");
    expect(SET.package).toMatch(/@mdi\/svg@\d+\.\d+\.\d+/);
  });

  it("ships the full set", () => {
    expect(SET.count).toBeGreaterThan(7000);
    expect(Object.keys(SET.icons)).toHaveLength(SET.count);
  });

  it("uses kebab-case mXn names throughout", () => {
    for (const name of iconNames(SET)) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("keeps names unique", () => {
    const names = iconNames(SET);
    expect(new Set(names).size).toBe(names.length);
  });

  it("stores plain path data with no colour slots or styling", () => {
    for (const icon of Object.values(SET.icons)) {
      expect(icon.d.length).toBeGreaterThan(4);
      expect(icon.d).not.toMatch(/currentColor|#[0-9a-fA-F]{3,8}/);
    }
  });

  it("uses a 24-unit viewBox, as mdi declares", () => {
    for (const icon of Object.values(SET.icons)) expect(icon.viewBox).toBe("0 0 24 24");
  });
});

describe("mXn naming", () => {
  it("prefixes names with mdi:", () => {
    expect(mxnName(SET, "folder")).toBe("mdi:folder");
    expect(mxnName(SET, "folder-outline")).toBe("mdi:folder-outline");
  });

  it("reports whether an outline twin actually exists", () => {
    expect(resolveName(SET, "folder", "outline")).toEqual({ name: "folder-outline", exact: true });
    expect(resolveName(SET, "chart-bar", "outline")).toEqual({ name: "chart-bar", exact: false });
  });

  it("returns nothing for an unknown name", () => {
    expect(resolveName(SET, "not-a-real-icon", "filled").name).toBe("");
    expect(shapeFor(SET, "not-a-real-icon", "filled")).toBeNull();
  });
});

describe("search", () => {
  it("finds by exact name", () => {
    expect(searchIcons(SET, "folder")).toContain("folder");
  });

  it("finds with or without hyphens, because people type both", () => {
    const hyphenated = searchIcons(SET, "folder-outline", 10);
    const spaced = searchIcons(SET, "folder outline", 10);
    expect(hyphenated).toContain("folder-outline");
    expect(spaced).toContain("folder-outline");
  });

  it("ranks the exact match first rather than burying it alphabetically", () => {
    // Without ranking, "folder outline" returns two hundred folder-* icons in alphabetical order
    // and the one asked for never reaches the first page.
    expect(searchIcons(SET, "folder outline", 5)[0]).toBe("folder-outline");
    expect(searchIcons(SET, "star", 3)[0]).toBe("star");
  });

  it("is case-insensitive", () => {
    expect(searchIcons(SET, "FOLDER", 10)).toContain("folder");
  });

  it("respects the limit", () => {
    expect(searchIcons(SET, "", 25)).toHaveLength(25);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchIcons(SET, "zzzznotanicon")).toEqual([]);
  });
});

describe("every default category resolves", () => {
  it.each(DEFAULT_CATEGORIES.map((c) => [c.id, c.icon]))("category %s -> %s exists", (_id, icon) => {
    expect(hasIcon(SET, icon)).toBe(true);
  });

  it("shapes every category in both styles", () => {
    const broken: string[] = [];
    for (const category of DEFAULT_CATEGORIES) {
      for (const style of ["filled", "outline"]) {
        const resolved = shapeFor(SET, category.icon, style);
        if (!resolved) broken.push(`${category.id}/${style}: missing`);
        else if (resolved.shape.d.length === 0) broken.push(`${category.id}/${style}: empty`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("loading", () => {
  it("reads once and caches", async () => {
    let calls = 0;
    setIconSetLoader(async () => {
      calls += 1;
      return SET;
    });
    const first = await loadIconSet();
    const second = await loadIconSet();
    expect(calls).toBe(1);
    expect(first).toBe(second);
    expect(loadedIconSet()).toBe(SET);
  });

  it("de-duplicates concurrent callers rather than racing two reads", async () => {
    let calls = 0;
    setIconSetLoader(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return SET;
    });
    const results = await Promise.all([loadIconSet(), loadIconSet(), loadIconSet()]);
    expect(calls).toBe(1);
    expect(results[0]).toBe(results[1]);
  });

  it("retries after a failure instead of caching the error forever", async () => {
    let calls = 0;
    setIconSetLoader(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return SET;
    });
    await expect(loadIconSet()).rejects.toThrow("transient");
    await expect(loadIconSet()).resolves.toBe(SET);
    expect(calls).toBe(2);
  });
});