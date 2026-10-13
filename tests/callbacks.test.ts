import { fire } from "../src/callbacks";
import { notices } from "./mocks/obsidian";

/**
 * `fire` is the only thing standing between a failed settings save and total silence. Obsidian's
 * `onChange`/`onClick` declare `=> void`, so without it a rejected save becomes an unhandled
 * rejection: the user clicks, nothing appears to happen, and the setting silently reverts on the
 * next launch.
 */

beforeEach(() => {
  notices.length = 0;
});

describe("fire", () => {
  it("returns a synchronous function, which is what Obsidian expects", () => {
    // The whole point: an `async` arrow here is what the submission review flags, and what turns a
    // rejection into an unhandled promise.
    const handler = fire(async () => {});
    expect(handler).not.toBeInstanceOf(Promise);
    expect(typeof handler.then).toBe("undefined");
  });

  it("runs the body and forwards its arguments", async () => {
    const seen: string[] = [];
    fire((value: string) => {
      seen.push(value);
    })("a");
    expect(seen).toEqual(["a"]);
  });

  it("swallows a rejection into a Notice rather than letting it escape", async () => {
    // Give the microtask queue a turn: the catch runs on the promise, not synchronously.
    fire(async () => {
      throw new Error("disk full");
    })();
    await Promise.resolve();
    await Promise.resolve();
    expect(notices.join("\n")).toContain("disk full");
  });

  it("names what failed, so the Notice is actionable", async () => {
    fire(async () => {
      throw new Error("boom");
    }, "保存设置")();
    await Promise.resolve();
    await Promise.resolve();
    expect(notices.join("\n")).toContain("保存设置");
  });

  it("reports a non-Error rejection too", async () => {
    fire(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "plain string";
    })();
    await Promise.resolve();
    await Promise.resolve();
    expect(notices.join("\n")).toContain("plain string");
  });

  it("shows nothing when the body succeeds", async () => {
    fire(async () => {})();
    await Promise.resolve();
    await Promise.resolve();
    expect(notices).toEqual([]);
  });
});