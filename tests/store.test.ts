import { diff, isManual, pruneMissing, reconcile, sameAssignment, type IconMap } from "../src/store";

/**
 * The store is the plugin's entire persisted state, so these check the two things that would be
 * expensive to notice later: growing without bound, and dropping a live note by accident.
 */

const live = new Set(["a.md", "b.md", "dir/c.md"]);

describe("comparing maps", () => {
  const before: IconMap = {
    "a.md": { categoryId: "task", icon: "star", theme: "outline", size: 16 },
    "gone.md": { categoryId: "x", icon: "flag", theme: "outline", size: 16 },
  };
  const after: IconMap = {
    "a.md": { categoryId: "task", icon: "star", theme: "outline", size: 16 },
    "b.md": { categoryId: "task", icon: "flag", theme: "outline", size: 16 },
  };

  it("reports added, changed and removed", () => {
    const d = diff(before, after);
    expect(d.added).toEqual(["b.md"]);
    expect(d.changed).toEqual([]);
    expect(d.removed).toEqual(["gone.md"]);
  });

  it("treats an identical entry as unchanged", () => {
    expect(diff({ "a.md": before["a.md"] }, { "a.md": before["a.md"] })).toEqual({
      added: [],
      changed: [],
      removed: [],
    });
  });

  it("treats a size change as a change", () => {
    const d = diff({ "a.md": before["a.md"] }, { "a.md": { ...before["a.md"], size: 24 } });
    expect(d.changed).toEqual(["a.md"]);
  });
});

describe("equality", () => {
  it("compares icon, theme and size", () => {
    const base = { categoryId: "x", icon: "star", theme: "outline", size: 16 };
    expect(sameAssignment(base, { ...base })).toBe(true);
    expect(sameAssignment(base, { ...base, icon: "flag" })).toBe(false);
    expect(sameAssignment(base, { ...base, theme: "two-tone" })).toBe(false);
    expect(sameAssignment(base, { ...base, size: 20 })).toBe(false);
  });

  it("ignores the category, which is metadata rather than appearance", () => {
    const a = { categoryId: "task", icon: "star", theme: "outline", size: 16 };
    const b = { categoryId: "idea", icon: "star", theme: "outline", size: 16 };
    expect(sameAssignment(a, b)).toBe(true);
  });
});

describe("pruning", () => {
  it("drops entries whose note is gone", () => {
    const map: IconMap = {
      "a.md": { categoryId: "x", icon: "star", theme: "outline", size: 16 },
      "gone.md": { categoryId: "x", icon: "star", theme: "outline", size: 16 },
    };
    expect(Object.keys(pruneMissing(map, (p) => live.has(p)))).toEqual(["a.md"]);
  });

  it("keeps notes nested in folders", () => {
    const map: IconMap = { "dir/c.md": { categoryId: "x", icon: "star", theme: "outline", size: 16 } };
    expect(Object.keys(pruneMissing(map, (p) => live.has(p)))).toEqual(["dir/c.md"]);
  });

  it("does not mutate the input", () => {
    const map: IconMap = { "gone.md": { categoryId: "x", icon: "star", theme: "outline", size: 16 } };
    pruneMissing(map, () => false);
    expect(Object.keys(map)).toEqual(["gone.md"]);
  });

  it("drops everything when nothing matches", () => {
    expect(pruneMissing({ "a.md": { categoryId: "x", icon: "s", theme: "outline", size: 16 } }, () => false)).toEqual({});
  });
});

describe("reconciling", () => {
  it("keeps only entries whose note still exists", () => {
    const next: IconMap = {
      "a.md": { categoryId: "x", icon: "star", theme: "outline", size: 16 },
      "ghost.md": { categoryId: "x", icon: "star", theme: "outline", size: 16 },
    };
    expect(Object.keys(reconcile({}, next, (p) => live.has(p)))).toEqual(["a.md"]);
  });
});
describe("recognising a hand-picked icon", () => {
  it("is true only for a manual assignment", () => {
    expect(isManual({ categoryId: "x", icon: "star", theme: "outline", size: 16, manual: true })).toBe(true);
    expect(isManual({ categoryId: "x", icon: "star", theme: "outline", size: 16 })).toBe(false);
    expect(isManual(undefined)).toBe(false);
  });

  it("does not treat a legacy entry without the flag as manual", () => {
    // Entries written before `manual` existed must not suddenly become untouchable.
    expect(isManual({ categoryId: "legacy", icon: "star", theme: "outline", size: 16 })).toBe(false);
  });
});
