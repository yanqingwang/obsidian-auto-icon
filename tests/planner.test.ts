import { buildPlan, type ScanInput } from "../src/planner";
import type { IconMap } from "../src/store";

const input = (over: Partial<ScanInput> = {}): ScanInput => ({
  path: "a.md",
  existing: null,
  classification: { categoryId: "task", score: 10, runnerUp: 0, reasons: ["标签 #task"] },
  categoryId: "task",
  icon: "checkbox-marked-circle",
  style: "filled",
  size: 16,
  ...over,
});

const NONE = { overwriteExisting: false, current: {} as IconMap };
const manual = (icon: string) => ({ categoryId: "custom", icon, style: "filled", size: 16, manual: true });

describe("assigning", () => {
  it("assigns a note with no icon yet", () => {
    const plan = buildPlan([input()], NONE);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      action: "assign",
      before: null,
      after: "checkbox-marked-circle",
      categoryId: "task",
    });
  });

  it("carries the reasons through for the preview", () => {
    expect(buildPlan([input()], NONE).changes[0].reasons).toEqual(["标签 #task"]);
  });
});

describe("leaving notes alone", () => {
  const current: IconMap = {
    "a.md": { categoryId: "task", icon: "checkbox-marked-circle", style: "filled", size: 16 },
  };

  it("skips a note whose icon is already exactly right", () => {
    const plan = buildPlan([input({ existing: current["a.md"] })], { ...NONE, current });
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("does not overwrite an existing icon by default", () => {
    const plan = buildPlan(
      [input({ existing: { categoryId: "x", icon: "star", style: "filled", size: 16 } })],
      NONE
    );
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("overwrites when asked", () => {
    const plan = buildPlan(
      [input({ existing: { categoryId: "x", icon: "star", style: "filled", size: 16 } })],
      { ...NONE, overwriteExisting: true }
    );
    expect(plan.changes[0]).toMatchObject({ action: "replace", before: "star" });
  });

  it("never clears an icon just because classification failed", () => {
    // Failing to match is not a reason to remove something the user may have picked deliberately.
    const plan = buildPlan(
      [
        input({
          existing: { categoryId: "x", icon: "compass", style: "filled", size: 16 },
          classification: { categoryId: null, score: 2, runnerUp: 0, reasons: [] },
          categoryId: null,
          icon: null,
        }),
      ],
      { ...NONE, overwriteExisting: true }
    );
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("reports a note with no signal as unmatched, not unchanged", () => {
    const plan = buildPlan(
      [input({ classification: { categoryId: null, score: 0, runnerUp: 0, reasons: [] }, categoryId: null, icon: null })],
      NONE
    );
    expect(plan.unmatched).toBe(1);
    expect(plan.unchanged).toBe(0);
  });
});

describe("comparing against the stored map", () => {
  it("an identical stored assignment is not a change", () => {
    const current: IconMap = {
      "a.md": { categoryId: "task", icon: "checkbox-marked-circle", style: "filled", size: 16 },
    };
    // No `existing` on the note at all: the map is the authority.
    expect(buildPlan([input()], { ...NONE, current }).changes).toEqual([]);
  });

  it("a size difference is skipped by default, and applied when overwrite is on", () => {
    const current: IconMap = {
      "a.md": { categoryId: "task", icon: "checkbox-marked-circle", style: "filled", size: 24 },
    };
    // Skipped: the note already has an icon, and overwrite is off.
    expect(buildPlan([input()], { ...NONE, current }).changes).toEqual([]);
    // Same icon, different size: a restyle rather than a replacement.
    expect(buildPlan([input()], { ...NONE, current, overwriteExisting: true }).changes[0]).toMatchObject({
      action: "restyle",
    });
  });

  it("an outline request on a filled icon is a restyle", () => {
    const plan = buildPlan(
      [input({ style: "outline" })],
      {
        overwriteExisting: true,
        current: {
          "a.md": { categoryId: "task", icon: "checkbox-marked-circle", style: "filled", size: 16 },
        },
      }
    );
    expect(plan.changes[0].action).toBe("restyle");
  });
});

describe("counts", () => {
  it("separates changed, unchanged and unmatched", () => {
    const plan = buildPlan(
      [
        input({ path: "a.md" }),
        input({ path: "b.md", existing: { categoryId: "t", icon: "checkbox-marked-circle", style: "filled", size: 16 } }),
        input({
          path: "c.md",
          classification: { categoryId: null, score: 0, runnerUp: 0, reasons: [] },
          categoryId: null,
          icon: null,
        }),
      ],
      NONE
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.unchanged).toBe(1);
    expect(plan.unmatched).toBe(1);
  });

  it("handles an empty vault", () => {
    const plan = buildPlan([], NONE);
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(0);
  });
});
/**
 * The recovery path for a wrong guess.
 *
 * Re-running the classifier just repeats the mistake, so a hand-picked icon has to survive the next
 * bulk scan — including a forced one, which exists precisely for the notes the classifier keeps
 * getting wrong.
 */
describe("hand-picked icons are protected", () => {
  const current: IconMap = { "a.md": manual("compass") };

  it("survives a forced rescan that disagrees", () => {
    const plan = buildPlan([input()], { overwriteExisting: true, current });
    expect(plan.changes).toEqual([]);
    expect(plan.protectedManual).toEqual(["a.md"]);
  });

  it("survives a normal rescan too", () => {
    const plan = buildPlan([input()], { overwriteExisting: false, current });
    expect(plan.changes).toEqual([]);
    expect(plan.protectedManual).toEqual(["a.md"]);
  });

  it("still allows a style change on a manual icon", () => {
    // Protecting the *choice of icon* must not freeze its appearance: a global restyle is not a
    // re-guess. Same icon name, different style.
    const sameIcon: IconMap = { "a.md": manual("checkbox-marked-circle") };
    const plan = buildPlan([input({ style: "outline" })], { overwriteExisting: true, current: sameIcon });
    expect(plan.changes).toHaveLength(1);
    expect(plan.protectedManual).toEqual([]);
  });

  it("does not protect a classifier-chosen icon", () => {
    const machine: IconMap = { "a.md": { categoryId: "task", icon: "star", style: "filled", size: 16 } };
    const plan = buildPlan([input()], { overwriteExisting: true, current: machine });
    expect(plan.changes).toHaveLength(1);
    expect(plan.protectedManual).toEqual([]);
  });

  it("does not report a manual icon as protected when the classifier agrees", () => {
    const agreeing: IconMap = { "a.md": manual("checkbox-marked-circle") };
    expect(buildPlan([input()], { overwriteExisting: true, current: agreeing }).protectedManual).toEqual([]);
  });
});
