import "./ui.css";
import { mountModelPanel, showError } from "./model-panel";
import { request } from "./protocol";

const button = document.querySelector<HTMLButtonElement>("#analyze");
const sample = document.querySelector<HTMLTextAreaElement>("#sample");
const result = document.querySelector<HTMLElement>("#result");
mountModelPanel();
button?.addEventListener("click", () => {
  if (!sample || !result || !sample.value.trim()) return;
  button.disabled = true;
  result.textContent = "Analyzing on this device…";
  void request("score", sample.value)
    .then(
      (reply) => {
        if (!reply.ok) {
          result.textContent =
            "Could not analyze this text. Review the error message and try again.";
          showError(reply.error);
          return;
        }
        if (!reply.score) return;
        result.textContent = `AI score ${(reply.score.value * 100).toFixed(1)}%\n${reply.score.tokens} token${reply.score.tokens === 1 ? "" : "s"} · ${reply.score.elapsedMs} ms · ${reply.status.backend}${reply.score.truncated ? "\nThe model read the first 512 tokens. The rest of the text was not scored." : ""}\nEstimates how much text AI wrote or edited. A score is not proof of AI use.`;
      },
      () =>
        showError(
          "Analysis was interrupted. Reload Slop Spot in chrome://extensions and try again."
        )
    )
    .finally(() => {
      button.disabled = false;
    });
});
