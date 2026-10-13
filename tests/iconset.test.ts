import { readFileSync } from "fs";
import path from "path";
import {
  collectionName,
  DEFAULT_ACCENT,
  hasIcon,
  iconNames,
  loadedIconSet,
  loadIconSet,
  searchIcons,
  setIconSetLoader,
  shapeFor,
  THEME_LIST,
  themeColours,
  themeUsesAccent,
  type IconSetMeta,
} from "../src/iconset";
import { DEFAULT_CATEGORIES } from "../src/categories";

const DEFAULT_ACCENT_LIGHT = "#43ccf8";

/**
 * These read the *real* generated `icons/iconpark.json`, not a fixture. The plugin's promise is
 * that the whole ByteDance set ships locally, so "every default category resolves" is a claim about
 * the shipped artefact and has to be tested against it.
 */

const SET = JSON.parse(
  readFileSync(path.join(__dirname, "..", "icons", "iconpark.json"), "utf8")
) as IconSetMeta;

beforeEach(() => setIconSetLoader(null));

describe("the shipped set", () => {
  it("is ByteDance IconPark, Apache-2.0", () => {
    expect(SET.source).toBe("IconPark");
    expect(SET.author).toBe("ByteDance");
    expect(SET.license).toBe("Apache-2.0");
    expect(SET.repo).toMatch(/bytedance\/iconpark/);
    expect(SET.package).toMatch(/@icon-park\/svg@\d+\.\d+\.\d+/);
  });

  it("uses the collection:name convention", () => {
    expect(SET.prefix).toBe("icon-park");
    expect(collectionName(SET, "folder-open")).toBe("icon-park:folder-open");
  });

  it("ships the full set", () => {
    expect(SET.count).toBeGreaterThan(2600);
    expect(Object.keys(SET.icons)).toHaveLength(SET.count);
  });

  it("offers all four themes, which is why they cost nothing", () => {
    expect(SET.themes).toEqual(["outline", "filled", "two-tone", "duotone"]);
  });

  it("stores kebab-case names with no leftover palette sentinels issue", () => {
    for (const name of iconNames(SET)) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("keeps the colour sentinels the theming relies on", () => {
    // Collected first: `expect` takes one argument, so a per-icon message cannot be attached.
    const missing = Object.entries(SET.icons).filter(([, i]) => !/C0/.test(i.body)).map(([n]) => n);
    expect(missing).toEqual([]);
  });

  it("has already hoisted the inheritable stroke attributes off the paths", () => {
    // If these were still per-path the stored form would be roughly 400 KB larger.
    for (const icon of Object.values(SET.icons)) {
      expect(icon.body).not.toMatch(/stroke-width=/);
      expect(icon.body).not.toMatch(/stroke-linecap=/);
      expect(icon.body).not.toMatch(/stroke-linejoin=/);
    }
  });
});

describe("theming", () => {
  it("substitutes every sentinel in all four themes", () => {
    // Collected first: jest's `expect` takes one argument, so a per-theme message cannot be attached.
    const broken: string[] = [];
    for (const theme of SET.themes) {
      const shape = shapeFor(SET, "folder-open", theme);
      if (!shape) broken.push(`${theme}: missing`);
      else if (/C[0-3]/.test(shape.body)) broken.push(`${theme}: sentinel leaked`);
    }
    expect(broken).toEqual([]);
  });

  it("paints the primary slot with the text colour, so icons work on dark themes", () => {
    // A hard-coded colour here is the single most common way a plugin's icons quietly disappear.
    expect(shapeFor(SET, "star", "outline")!.body).toContain('stroke="currentColor"');
  });

  it("actually changes the markup between themes", () => {
    const outline = shapeFor(SET, "folder-open", "outline")!.body;
    const twoTone = shapeFor(SET, "folder-open", "two-tone")!.body;
    expect(outline).not.toBe(twoTone);
  });

  it("carries the hoisted stroke attributes onto the shape", () => {
    const shape = shapeFor(SET, "star", "outline")!;
    expect(shape.stroke).toBe(SET.stroke);
    expect(shape.strokeLinecap).toBe(SET.strokeLinecap);
  });

  it("falls back to the first theme for an unknown name rather than throwing", () => {
    expect(shapeFor(SET, "star", "nonsense")!.body).toBe(shapeFor(SET, "star", "outline")!.body);
  });

  it("returns null for an icon that does not exist", () => {
    expect(shapeFor(SET, "definitely-not-an-icon", "outline")).toBeNull();
  });
});

describe("theme colours", () => {
  it("only the accent themes use an accent", () => {
    expect(themeUsesAccent("outline")).toBe(false);
    expect(themeUsesAccent("filled")).toBe(false);
    expect(themeUsesAccent("two-tone")).toBe(true);
    expect(themeUsesAccent("duotone")).toBe(true);
  });

  it("honours a custom accent", () => {
    expect(themeColours("two-tone", "#ff0000")).toContain("#ff0000");
  });

  it("derives a lighter companion for duotone", () => {
    const light = themeColours("duotone", "#000000")[3];
    expect(light).not.toBe(DEFAULT_ACCENT_LIGHT);
    expect(light).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("lists exactly four themes", () => {
    expect(THEME_LIST).toHaveLength(4);
  });
});

describe("search", () => {
  it("finds by exact name", () => {
    expect(searchIcons(SET, "folder-open")).toContain("folder-open");
  });

  it("finds with or without hyphens, because people type both", () => {
    expect(searchIcons(SET, "folder open", 10)).toContain("folder-open");
  });

  it("ranks the exact match first rather than burying it alphabetically", () => {
    // Without ranking, "folder" returns hundreds of folder-* icons in alphabetical order.
    expect(searchIcons(SET, "rocket", 3)[0]).toBe("rocket");
  });

  it("is case-insensitive and respects the limit", () => {
    expect(searchIcons(SET, "ROCKET", 5)).toContain("rocket");
    expect(searchIcons(SET, "", 25)).toHaveLength(25);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchIcons(SET, "zzzznotanicon")).toEqual([]);
  });
});

describe("every default category resolves in every theme", () => {
  it.each(DEFAULT_CATEGORIES.map((c) => [c.id, c.icon]))("category %s -> %s exists", (_id, icon) => {
    expect(hasIcon(SET, icon)).toBe(true);
  });

  it("shapes all 32 categories in all four themes", () => {
    const broken: string[] = [];
    for (const category of DEFAULT_CATEGORIES) {
      for (const theme of SET.themes) {
        const shape = shapeFor(SET, category.icon, theme);
        if (!shape) broken.push(`${category.id}/${theme}: missing`);
        else if (/C[0-3]/.test(shape.body)) broken.push(`${category.id}/${theme}: sentinel leaked`);
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
    await loadIconSet();
    await loadIconSet();
    expect(calls).toBe(1);
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