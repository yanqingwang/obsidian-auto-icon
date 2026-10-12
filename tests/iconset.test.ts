import { readFileSync } from "fs";
import path from "path";
import {
  hasIcon,
  iconNames,
  loadedIconSet,
  loadIconSet,
  setIconSetLoader,
  shapeFor,
  type IconSetMeta,
} from "../src/iconset";
import { DEFAULT_CATEGORIES } from "../src/categories";

/**
 * These read the *real* generated `icons/iconpark.json`, not a fixture. The point of the plugin is
 * that the whole set ships locally, so "every default category resolves" is a claim about the
 * shipped artefact and has to be tested against it.
 */

const SET_PATH = path.join(__dirname, "..", "icons", "iconpark.json");
const real = JSON.parse(readFileSync(SET_PATH, "utf8")) as IconSetMeta;

beforeEach(() => {
  setIconSetLoader(null);
});

describe("the shipped icon set", () => {
  it("is IconPark, Apache-2.0, and declares its provenance", () => {
    expect(real.source).toBe("IconPark");
    expect(real.license).toBe("Apache-2.0");
    expect(real.package).toMatch(/@icon-park\/svg@\d+\.\d+\.\d+/);
  });

  it("carries a substantial number of icons", () => {
    expect(real.count).toBeGreaterThan(2000);
    expect(Object.keys(real.icons)).toHaveLength(real.count);
  });

  it("offers all four themes, which is the whole reason for choosing IconPark", () => {
    expect(real.themes).toEqual(["outline", "filled", "two-tone", "multi-color"]);
  });

  it("carries each icon's own viewBox rather than assuming one", () => {
    // IconPark is overwhelmingly 48x48, but nine icons are 49x48. The generator records what each
    // icon actually declares and the renderer passes it through, so those nine draw correctly
    // instead of being silently clipped or stretched.
    const counts = new Map<string, number>();
    for (const icon of Object.values(real.icons)) {
      counts.set(icon.viewBox, (counts.get(icon.viewBox) ?? 0) + 1);
    }
    expect(counts.get("0 0 48 48")).toBeGreaterThan(2600);
    for (const viewBox of counts.keys()) expect(viewBox).toMatch(/^0 0 \d+ \d+$/);
  });

  it("keeps the colour sentinels the generator relies on", () => {
    for (const [name, icon] of Object.entries(real.icons)) {
      expect(icon.body).toMatch(/C0/, `${name} has no primary slot`);
    }
  });

  it("has already hoisted the inheritable stroke attributes off the paths", () => {
    // If these were still on each path, the stored form would be roughly 400 KB larger.
    for (const icon of Object.values(real.icons)) {
      expect(icon.body).not.toMatch(/stroke-width=/);
      expect(icon.body).not.toMatch(/stroke-linecap=/);
      expect(icon.body).not.toMatch(/stroke-linejoin=/);
    }
  });

  it("contains no leftover JSX or XML prolog", () => {
    for (const icon of Object.values(real.icons)) {
      expect(icon.body).not.toContain("<?xml");
      expect(icon.body).not.toContain("${");
    }
  });
});

describe("every default category resolves", () => {
  it.each(DEFAULT_CATEGORIES.map((c) => [c.id, c.icon]))("category %s -> %s exists", (_id, icon) => {
    expect(hasIcon(real, icon)).toBe(true);
  });

  it("shapes every category in every theme", () => {
    // Collected and asserted at once: jest's `expect` takes a single argument, so a per-iteration
    // message cannot be attached here.
    const broken: string[] = [];
    for (const category of DEFAULT_CATEGORIES) {
      for (const theme of ["outline", "filled", "two-tone", "multi-color"]) {
        const shape = shapeFor(real, category.icon, theme);
        if (!shape) {
          broken.push(`${category.id}/${theme}: missing`);
        } else if (/C[0-3]/.test(shape.body)) {
          broken.push(`${category.id}/${theme}: sentinel leaked`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("theming", () => {
  it("substitutes no sentinels survive into a rendered shape", () => {
    for (const theme of real.themes) {
      expect(shapeFor(real, "folder", theme)!.body).not.toMatch(/C[0-3]/);
    }
  });

  it("paints the primary slot with the text colour, so icons work on dark themes", () => {
    expect(shapeFor(real, "star", "outline")!.body).toContain('stroke="currentColor"');
  });

  it("makes the themes actually differ", () => {
    const a = shapeFor(real, "folder", "outline")!.body;
    const b = shapeFor(real, "folder", "two-tone")!.body;
    expect(a).not.toBe(b);
  });

  it("honours a custom accent colour", () => {
    const shape = shapeFor(real, "folder", "two-tone", "#ff0000")!.body;
    expect(shape).toContain("#ff0000");
  });

  it("falls back to the first theme for an unknown name rather than throwing", () => {
    expect(shapeFor(real, "star", "not-a-theme")!.body).toBe(
      shapeFor(real, "star", "outline")!.body
    );
  });

  it("returns null for an icon that does not exist", () => {
    expect(shapeFor(real, "definitely-not-an-icon", "outline")).toBeNull();
  });
});

describe("loading", () => {
  it("reads once and caches", async () => {
    let calls = 0;
    setIconSetLoader(async () => {
      calls += 1;
      return real;
    });

    const first = await loadIconSet();
    const second = await loadIconSet();

    expect(calls).toBe(1);
    expect(first).toBe(second);
    expect(loadedIconSet()).toBe(real);
  });

  it("de-duplicates concurrent callers rather than racing two reads", async () => {
    let calls = 0;
    setIconSetLoader(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return real;
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
      return real;
    });

    await expect(loadIconSet()).rejects.toThrow("transient");
    await expect(loadIconSet()).resolves.toBe(real);
    expect(calls).toBe(2);
  });
});

describe("naming", () => {
  it("addresses icons in kebab-case", () => {
    for (const name of iconNames(real)) {
      expect(name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("keeps kebab names unique", () => {
    const names = iconNames(real);
    expect(new Set(names).size).toBe(names.length);
  });
});