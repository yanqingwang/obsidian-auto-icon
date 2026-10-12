import { buildPlan, type ScanInput } from "../src/planner";

const input = (over: Partial<ScanInput> = {}): ScanInput => ({
  path: "a.md",
  currentIcon: null,
  classification: { categoryId: "task", score: 10, runnerUp: 0, reasons: ["标签 #task"] },
  icon: "lucide:list-checks",
  ...over,
});

describe("assigning", () => {
  it("assigns when there is no icon yet", () => {
    const plan = buildPlan([input()], { overwriteExisting: false });
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      action: "assign",
      before: null,
      after: "lucide:list-checks",
      categoryId: "task",
    });
  });

  it("carries the reasons through for the preview", () => {
    const plan = buildPlan([input()], { overwriteExisting: false });
    expect(plan.changes[0].reasons).toEqual(["标签 #task"]);
  });
});

describe("leaving notes alone", () => {
  it("skips a note whose icon is already correct", () => {
    const plan = buildPlan([input({ currentIcon: "lucide:list-checks" })], { overwriteExisting: true });
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("does not overwrite an existing icon by default", () => {
    const plan = buildPlan([input({ currentIcon: "emoji:🎯" })], { overwriteExisting: false });
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("overwrites when asked", () => {
    const plan = buildPlan([input({ currentIcon: "emoji:🎯" })], { overwriteExisting: true });
    expect(plan.changes[0]).toMatchObject({ action: "replace", before: "emoji:🎯" });
  });

  it("writes nothing when no category matched", () => {
    const plan = buildPlan(
      [input({ classification: { categoryId: null, score: 0, runnerUp: 0, reasons: [] }, icon: null })],
      { overwriteExisting: false }
    );
    expect(plan.changes).toEqual([]);
    expect(plan.unmatched).toBe(1);
  });

  it("never clears an icon just because classification failed", () => {
    // The important asymmetry: a failed match leaves the existing icon alone rather than removing it.
    const plan = buildPlan(
      [
        input({
          currentIcon: "emoji:🧭",
          classification: { categoryId: null, score: 2, runnerUp: 0, reasons: [] },
          icon: null,
        }),
      ],
      { overwriteExisting: true }
    );
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("writes nothing when the category exists but its icon cannot resolve", () => {
    const plan = buildPlan([input({ icon: null })], { overwriteExisting: false });
    expect(plan.changes).toEqual([]);
  });
});

describe("counts", () => {
  it("separates changed, unchanged and unmatched", () => {
    const plan = buildPlan(
      [
        input({ path: "a.md" }),
        input({ path: "b.md", currentIcon: "lucide:list-checks" }),
        input({
          path: "c.md",
          classification: { categoryId: null, score: 0, runnerUp: 0, reasons: [] },
          icon: null,
        }),
      ],
      { overwriteExisting: false }
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.unchanged).toBe(1);
    expect(plan.unmatched).toBe(1);
  });

  it("preserves input order", () => {
    const plan = buildPlan(
      [input({ path: "z.md" }), input({ path: "a.md" })],
      { overwriteExisting: false }
    );
    expect(plan.changes.map((c) => c.path)).toEqual(["z.md", "a.md"]);
  });

  it("handles an empty vault", () => {
    const plan = buildPlan([], { overwriteExisting: false });
    expect(plan.changes).toEqual([]);
    expect(plan.totalChanges).toBeUndefined();
  });
});