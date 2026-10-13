import { normaliseAssignments } from "../src/store";

/**
 * `data.json` is per-device state that outlives upgrades, so its shape is untrusted input. The
 * regression this guards is silent: version 0.2.0 stored `style` where 0.3.0 stores `theme`, and a
 * blind cast reads `undefined` and quietly repaints every hand-picked icon with no error anywhere.
 */

describe("reading a stored map written by an older version", () => {
  it("carries `style` over to `theme`", () => {
    const map = normaliseAssignments({
      "notes/a.md": { categoryId: "task", icon: "checklist", style: "two-tone", size: 18 },
    });
    expect(map["notes/a.md"].theme).toBe("two-tone");
  });

  it("keeps `manual: true`, or the first scan after updating overwrites the user's own choice", () => {
    const map = normaliseAssignments({
      "notes/a.md": { categoryId: "x", icon: "star", style: "outline", size: 16, manual: true },
    });
    expect(map["notes/a.md"].manual).toBe(true);
  });

  it("does not invent `manual` on a machine-assigned icon", () => {
    const map = normaliseAssignments({
      "notes/a.md": { categoryId: "x", icon: "star", style: "outline", size: 16 },
    });
    expect(map["notes/a.md"].manual).toBeUndefined();
  });

  it("reads a current-format entry unchanged", () => {
    const map = normaliseAssignments({
      "notes/a.md": { categoryId: "task", icon: "checklist", theme: "duotone", size: 18 },
    });
    expect(map["notes/a.md"]).toEqual({
      categoryId: "task",
      icon: "checklist",
      theme: "duotone",
      size: 18,
    });
  });

  it("prefers `theme` when a file somehow carries both", () => {
    const map = normaliseAssignments({
      "a.md": { categoryId: "x", icon: "star", theme: "filled", style: "outline", size: 16 },
    });
    expect(map["a.md"].theme).toBe("filled");
  });
});

describe("rejecting unusable entries", () => {
  it("falls back to a valid theme rather than storing one that cannot render", () => {
    // An unknown theme would resolve to the first theme anyway, but only by accident of the
    // lookup order; making it explicit keeps the stored value honest.
    const map = normaliseAssignments({
      "a.md": { categoryId: "x", icon: "star", theme: "neon", size: 16 },
    });
    expect(map["a.md"].theme).toBe("outline");
  });

  it("defaults a missing or nonsensical size", () => {
    const map = normaliseAssignments({
      "a.md": { categoryId: "x", icon: "star", size: 0 },
      "b.md": { categoryId: "x", icon: "star", size: "big" },
      "c.md": { categoryId: "x", icon: "star" },
    });
    expect(map["a.md"].size).toBe(16);
    expect(map["b.md"].size).toBe(16);
    expect(map["c.md"].size).toBe(16);
  });

  it("drops entries missing the fields that make an icon addressable", () => {
    // A half-valid assignment draws the wrong icon with no way for the user to tell why.
    const map = normaliseAssignments({
      "no-icon.md": { categoryId: "x", size: 16 },
      "no-category.md": { icon: "star", size: 16 },
      "empty-icon.md": { categoryId: "x", icon: "", size: 16 },
      "not-an-object.md": "star",
      "ok.md": { categoryId: "x", icon: "star", size: 16 },
    });
    expect(Object.keys(map)).toEqual(["ok.md"]);
  });

  it("survives a corrupt or missing settings file", () => {
    for (const bad of [null, undefined, 42, "nonsense", []]) {
      expect(normaliseAssignments(bad)).toEqual({});
    }
  });
});