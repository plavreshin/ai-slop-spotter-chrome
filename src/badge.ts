import type { Score } from "./protocol";

export function createBadge(score: Score, threshold: number, shortText = false): HTMLElement {
  const host = document.createElement("span");
  host.className = "slop-spot-host";
  host.dataset.flagged = String(score.value >= threshold);
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { display:inline-block; vertical-align:middle; margin-inline:7px; font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    button { font:inherit; color:#b42318; background:#fff0ed; border:1px solid #f4b8ae; border-radius:5px; padding:1px 6px; cursor:pointer; white-space:nowrap; }
    button:hover { background:#ffded7; }
    button:focus-visible { outline:2px solid #b42318; outline-offset:2px; }
    :host([data-flagged="false"]) button { color:#5c5754; background:#f5f3f1; border-color:#d6d0ca; }
    [popover] { position:fixed; inset:auto; width:280px; max-width:calc(100vw - 24px); margin:0; padding:16px; border:1px solid #c9b7b1; border-radius:10px; background:#fffaf8; color:#332824; box-shadow:0 8px 30px #0003; font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    strong { color:#b42318; } p { margin:8px 0; } .small { font-size:11px; color:#6b5c56; }
    @media(prefers-color-scheme:dark) { button { color:#ffaca0; background:#44221e; border-color:#94473b; } button:hover { background:#5b2c25; } [popover] { background:#28201d; color:#f5e8e2; border-color:#75584d; } strong { color:#ffaca0; } .small { color:#c5b0a5; } }
    @media(prefers-color-scheme:dark) { :host([data-flagged="false"]) button { color:#d1c9c3; background:#302b28; border-color:#655b55; } }
  `;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `AI score ${Math.round(score.value * 100)}%`;
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "explanation");
  button.title = "Estimate of AI involvement. Select for details. Scores can be wrong.";
  const panel = document.createElement("div");
  panel.id = "explanation";
  panel.popover = "auto";
  const heading = document.createElement("strong");
  heading.textContent = `AI score: ${(score.value * 100).toFixed(1)}%`;
  const explanation = document.createElement("p");
  explanation.textContent =
    "Estimates how much text AI wrote or edited. A score is not proof of AI use.";
  const info = document.createElement("p");
  info.className = "small";
  info.textContent = `Highlight threshold: ${Math.round(threshold * 100)}%. ${score.truncated ? "The model read the first 512 tokens. The rest of the message was not scored." : `The model read ${score.tokens} token${score.tokens === 1 ? "" : "s"}.`} ${shortText ? "Scores and language detection are less reliable for short messages. " : ""}English model. No message uploads.`;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    panel.hidePopover();
    button.focus();
  });
  panel.append(heading, explanation, info, close);
  panel.addEventListener("toggle", () =>
    button.setAttribute("aria-expanded", String(panel.matches(":popover-open")))
  );
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (panel.matches(":popover-open")) {
      panel.hidePopover();
      return;
    }
    const rect = button.getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 292))}px`;
    panel.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 280))}px`;
    panel.showPopover();
    close.focus();
  });
  root.append(style, button, panel);
  return host;
}
