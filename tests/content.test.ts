// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { Reply, Request } from "../src/protocol";
import { DEFAULT_SETTINGS } from "../src/settings";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("discards edited text results, updates thresholds, pauses, and removes badges after model deletion", async () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  window.history.replaceState(null, "", "/client/example/channel");
  vi.stubGlobal("location", new URL("https://app.slack.com/client/example/channel"));
  const english =
    "The release is delayed until Thursday. I found a bug in the account import this morning: rows with an empty country field get dropped without an error. I have a fix ready, but I want to run it against last week's export before we ship. Please hold off on sending the announcement. I will post the test results here after lunch and update the release notes if anything else changes.";
  document.body.innerHTML =
    '<div class="c-message_kit__message"><header class="c-message_kit__header">Author 12:01</header><div class="c-message_kit__blocks"></div></div>';
  const body = document.querySelector(".c-message_kit__blocks");
  if (!body) throw new Error("Missing fixture body");
  body.textContent = english;
  const offscreen = document.createElement("div");
  offscreen.className = "c-message_kit__message";
  offscreen.dataset.viewport = "offscreen";
  offscreen.innerHTML = '<div class="c-message_kit__blocks"></div>';
  const offscreenBody = offscreen.firstElementChild;
  if (!offscreenBody) throw new Error("Missing offscreen fixture body");
  offscreenBody.textContent = english;
  const offscreenExtraction = vi.spyOn(offscreenBody, "cloneNode");
  document.body.append(offscreen);
  let changeVisibility: (target: Element, visible: boolean) => void = () => {
    throw new Error("Observer not initialized");
  };
  let settings = { ...DEFAULT_SETTINGS };
  let modelReady = true;
  const listeners: ((
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => void)[] = [];
  const pending: ((reply: Reply) => void)[] = [];
  const sendMessage = vi.fn(
    (_message: Request) => new Promise<Reply>((resolve) => pending.push(resolve))
  );
  vi.stubGlobal("chrome", {
    runtime: { sendMessage },
    storage: {
      local: { get: async (key: string) => (key === "settings" ? { settings } : { modelReady }) },
      onChanged: {
        addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
      },
    },
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly scrollMargin = "0px";
      readonly thresholds = [0];
      constructor(private readonly callback: IntersectionObserverCallback) {
        changeVisibility = (target, visible) => this.notify(target, visible);
      }
      notify(target: Element, visible: boolean): void {
        const rect = target.getBoundingClientRect();
        this.callback(
          [
            {
              target,
              isIntersecting: visible,
              intersectionRatio: visible ? 1 : 0,
              time: 0,
              boundingClientRect: rect,
              intersectionRect: rect,
              rootBounds: rect,
            },
          ],
          this
        );
      }
      observe(target: Element): void {
        this.notify(
          target,
          !(target instanceof HTMLElement) || target.dataset.viewport !== "offscreen"
        );
      }
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
  );
  await import("../src/content");
  await vi.advanceTimersByTimeAsync(700);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(offscreenExtraction).not.toHaveBeenCalled();
  body.textContent = `${english} Please check the attachment tomorrow.`;
  await vi.advanceTimersByTimeAsync(350);
  const reply: Reply = {
    ok: true,
    status: { phase: "ready", downloaded: 1, total: 1, detail: "Ready", backend: "WebGPU" },
    score: { value: 0.92, tokens: 100, truncated: false, elapsedMs: 40 },
  };
  pending.shift()?.(reply);
  await vi.advanceTimersByTimeAsync(700);
  expect(document.querySelector(".slop-spot-host")).toBeNull();
  await vi.advanceTimersByTimeAsync(5000);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  pending.shift()?.(reply);
  await vi.advanceTimersByTimeAsync(350);
  expect(document.querySelectorAll(".slop-spot-host")).toHaveLength(1);
  const change = async (key: string): Promise<void> => {
    for (const listener of listeners) listener({ [key]: {} }, "local");
    await vi.advanceTimersByTimeAsync(700);
  };
  settings = { ...settings, threshold: 0.95 };
  await change("settings");
  expect(document.querySelector<HTMLElement>(".slop-spot-host")?.dataset.flagged).toBe("false");
  settings = { ...settings, threshold: 0.75 };
  await change("settings");
  expect(document.querySelectorAll(".slop-spot-host")).toHaveLength(1);
  expect(document.querySelector<HTMLElement>(".slop-spot-host")?.dataset.flagged).toBe("true");
  settings = { ...settings, paused: true };
  await change("settings");
  expect(document.querySelector(".slop-spot-host")).toBeNull();
  settings = { ...settings, paused: false };
  hidden = true;
  await change("settings");
  expect(document.querySelector(".slop-spot-host")).toBeNull();
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(700);
  expect(document.querySelectorAll(".slop-spot-host")).toHaveLength(1);
  document.querySelector(".slop-spot-host")?.remove();
  await vi.advanceTimersByTimeAsync(6000);
  expect(document.querySelectorAll(".slop-spot-host")).toHaveLength(1);
  const row = body.closest(".c-message_kit__message");
  if (!row) throw new Error("Missing visible row");
  body.textContent = "Thanks, I'll check after lunch.";
  await vi.advanceTimersByTimeAsync(700);
  expect(sendMessage).toHaveBeenCalledTimes(3);
  changeVisibility(row, false);
  pending.shift()?.(reply);
  await vi.advanceTimersByTimeAsync(700);
  expect(document.querySelector(".slop-spot-host")).toBeNull();
  expect(sendMessage).toHaveBeenCalledTimes(3);
  expect(offscreenExtraction).not.toHaveBeenCalled();
  changeVisibility(row, true);
  await vi.advanceTimersByTimeAsync(700);
  expect(sendMessage).toHaveBeenCalledTimes(4);
  pending.shift()?.({
    ...reply,
    score: { value: 0.12, tokens: 10, truncated: false, elapsedMs: 20 },
  });
  await vi.advanceTimersByTimeAsync(700);
  expect(document.querySelector<HTMLElement>(".slop-spot-host")?.dataset.flagged).toBe("false");
  body.textContent = english;
  await vi.advanceTimersByTimeAsync(700);
  expect(sendMessage).toHaveBeenCalledTimes(5);
  vi.stubGlobal("location", new URL("https://app.slack.com/client/example/other-channel"));
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.advanceTimersByTimeAsync(700);
  pending.shift()?.(reply);
  await vi.advanceTimersByTimeAsync(700);
  expect(document.querySelector(".slop-spot-host")).toBeNull();
  expect(sendMessage).toHaveBeenCalledTimes(6);
  pending.shift()?.(reply);
  await vi.advanceTimersByTimeAsync(700);
  expect(document.querySelector<HTMLElement>(".slop-spot-host")?.dataset.flagged).toBe("true");
  modelReady = false;
  await change("modelReady");
  expect(document.querySelector(".slop-spot-host")).toBeNull();
  await vi.advanceTimersByTimeAsync(6000);
  expect(sendMessage).toHaveBeenCalledTimes(6);
});
