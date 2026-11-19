import { describe, expect, it } from "vitest";
import { eligible, prepareText, sigmoid } from "../src/text";
import { DEFAULT_SETTINGS, enabled, parseSettings, clientPathFromUrl } from "../src/settings";
import { isReply, isRequest } from "../src/protocol";
import { MODEL_ASSETS, MODEL_REVISION, TOTAL_BYTES } from "../src/model";

const english =
  "The release is delayed until Thursday. I found a bug in the account import this morning: rows with an empty country field get dropped without an error. I have a fix ready, but I want to run it against last week's export before we ship. Please hold off on sending the announcement. I will post the test results here after lunch and update the release notes if anything else changes.";
describe("message eligibility and model preprocessing", () => {
  it("accepts short English messages and link-heavy notifications, skips non-English text", () => {
    expect(eligible(english)).toBe(true);
    expect(eligible("Thanks, I'll check after lunch.")).toBe(true);
    expect(
      eligible(
        "Hey @Alex Morgan, you have been picked to do a code review: https://example.com/review/123 by Casey.Smith"
      )
    ).toBe(true);
    expect(eligible("Hi")).toBe(true);
    expect(eligible("https://example.com/review/123")).toBe(false);
    expect(
      eligible(
        "Это сообщение написано на русском языке. Нам нужно проверить работу приложения и исправить ошибки перед выпуском новой версии. ".repeat(
          8
        )
      )
    ).toBe(false);
  });
  it("empties code before counting words, including unfinished fenced blocks", () => {
    expect(prepareText("Before\n```typescript\nconst secret = 123;\n```\nAfter")).toBe(
      "Before\n```\n```\nAfter"
    );
    expect(eligible(`\`\`\`js\n${english}\n\`\`\``)).toBe(false);
    expect(prepareText("Before\n```js\nunfinished")).toBe("Before\n```\n```");
  });
  it("uses sigmoid, with stable extreme values", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(1000)).toBe(1);
    expect(sigmoid(-1000)).toBe(0);
  });
});
describe("Slack page access and settings", () => {
  it("accepts only Slack client URLs", () => {
    expect(clientPathFromUrl("https://app.slack.com/client/example/channel")).toBe(
      "/client/example/channel"
    );
    for (const url of [
      "https://app.slack.com.evil.test/client/example",
      "http://app.slack.com/client/example",
      "https://app.slack.com/signin",
      "https://app.slack.com/client/",
      "https://app.slack.com/client",
      "invalid",
    ])
      expect(clientPathFromUrl(url)).toBeUndefined();
  });
  it("enables Slack pages and respects pause", () => {
    expect(enabled(DEFAULT_SETTINGS, "/client/example/channel")).toBe(true);
    expect(enabled(DEFAULT_SETTINGS, undefined)).toBe(false);
    expect(enabled({ ...DEFAULT_SETTINGS, paused: true }, "/client/example/channel")).toBe(false);
    expect(parseSettings({ unrelated: [] })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ threshold: NaN }).threshold).toBe(0.75);
    expect(parseSettings({ threshold: 10 }).threshold).toBe(0.99);
  });
});
describe("runtime boundary", () => {
  it("rejects malformed and oversized requests", () => {
    expect(isRequest({ target: "background", command: "score", text: english })).toBe(true);
    for (const value of [
      null,
      {},
      { target: "background", command: "fetch", text: english },
      { target: "offscreen", command: "score" },
      { target: "background", command: "score", text: "x".repeat(100001) },
    ])
      expect(isRequest(value)).toBe(false);
  });
  it("rejects invalid scores rather than showing a badge", () => {
    const status = { phase: "ready", downloaded: 1, total: 1, backend: "WebGPU", detail: "Ready" };
    const score = { value: 0.92, tokens: 100, truncated: false, elapsedMs: 30 };
    expect(isReply({ ok: true, status, score })).toBe(true);
    expect(isReply({ ok: true, status, score: { ...score, value: NaN } })).toBe(false);
    expect(isReply({ ok: true, status, score: { ...score, value: 92 } })).toBe(false);
    for (const invalid of [NaN, Infinity, -1, 0, 1.5, 513])
      expect(isReply({ ok: true, status, score: { ...score, tokens: invalid } })).toBe(false);
    for (const invalid of [NaN, Infinity, -1])
      expect(isReply({ ok: true, status, score: { ...score, elapsedMs: invalid } })).toBe(false);
    for (const invalid of [NaN, Infinity, -1, 2])
      expect(isReply({ ok: true, status: { ...status, downloaded: invalid }, score })).toBe(false);
    expect(isReply({ ok: true, status: { ...status, total: 0 } })).toBe(false);
    expect(
      isReply({
        ok: true,
        status: {
          ...status,
          phase: {
            toString() {
              throw new Error("Do not coerce status");
            },
          },
        },
      })
    ).toBe(false);
  });
  it("pins every model asset to a size and SHA-256", () => {
    expect(MODEL_REVISION).toMatch(/^[a-f0-9]{40}$/u);
    expect(TOTAL_BYTES).toBe(760586474);
    for (const asset of MODEL_ASSETS) expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
