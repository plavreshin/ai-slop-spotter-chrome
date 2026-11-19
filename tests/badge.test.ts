// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createBadge } from "../src/badge";

it("shows scores below the threshold with neutral styling", () => {
  const badge = createBadge(
    { value: 0.12, tokens: 20, elapsedMs: 100, truncated: false },
    0.75,
    true
  );
  expect(badge.dataset.flagged).toBe("false");
  expect(badge.shadowRoot?.querySelector("button")?.textContent).toBe("AI score 12%");
  expect(badge.shadowRoot?.textContent).toContain(
    "Scores and language detection are less reliable for short messages."
  );
});

it("flags high scores and explains truncation", () => {
  const badge = createBadge({ value: 0.92, tokens: 512, elapsedMs: 100, truncated: true }, 0.75);
  expect(badge.dataset.flagged).toBe("true");
  expect(badge.shadowRoot?.querySelector("button")?.textContent).toBe("AI score 92%");
  expect(badge.shadowRoot?.textContent).toContain(
    "The model read the first 512 tokens. The rest of the message was not scored."
  );
});
