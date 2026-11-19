// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { placeBadge, messageText } from "../src/slack";

describe("Slack extraction", () => {
  it("keeps prose and paragraph boundaries while excluding code, previews, and badges", () => {
    const row = document.createElement("div");
    row.innerHTML =
      '<header class="c-message_kit__header">Author 12:01</header><div class="c-message_kit__blocks"><div class="p-rich_text_section">First paragraph.</div><div class="p-rich_text_section">Second paragraph.<br>Next line.</div><pre>secret code</pre><div class="c-unfurl">Linked page contents</div><span class="slop-spot-host">AI score 99%</span></div><div class="c-message_kit__attachments">Attachment text</div>';
    expect(messageText(row)).toBe("First paragraph.\nSecond paragraph.\nNext line.\n\n```\n```");
    const badge = document.createElement("span");
    placeBadge(row, badge);
    expect(badge.parentElement).toBe(row.querySelector("header"));
  });
  it("places badges after timestamps in the current Slack layout, outside timestamp links", () => {
    const row = document.createElement("div");
    row.innerHTML =
      '<div class="c-message_kit__gutter__right"><span>Author</span><a class="c-timestamp">12:01</a><br><div class="c-message_kit__blocks">Message body</div></div>';
    const badge = document.createElement("span");
    badge.className = "slop-spot-host";
    placeBadge(row, badge);
    expect(row.querySelector(".c-timestamp")?.nextElementSibling).toBe(badge);
    expect(messageText(row)).toBe("Message body");
  });
  it("ignores drafts and rows with no message body", () => {
    const draft = document.createElement("div");
    draft.innerHTML = '<div contenteditable="true">Unsent text</div>';
    expect(messageText(draft)).toBe("");
  });
});
