/**
 * Callback helpers for Obsidian's UI APIs.
 *
 * Obsidian's `Setting.onChange` / `Button.onClick` / `Component.onClick` declare `=> void`. Handing
 * them an `async` arrow passes a promise nobody awaits, so a rejected save surfaces as an unhandled
 * rejection with nothing on screen — the user clicks, nothing appears to happen, and the setting
 * silently reverts on the next launch.
 *
 * `fire` keeps the body async but makes the arrow itself synchronous, and turns a rejection into a
 * Notice the user can actually see.
 */

import { Notice } from "obsidian";

const PREFIX = "Auto Icon";

export function fire<A extends unknown[]>(
  body: (...args: A) => Promise<unknown> | unknown,
  what = "操作",
): (...args: A) => void {
  return (...args: A) => {
    void Promise.resolve(body(...args)).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      new Notice(`${PREFIX}：${what}失败 —— ${detail}`);
    });
  };
}
