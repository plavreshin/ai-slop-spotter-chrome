import "./ui.css";
import { mountModelPanel, showError } from "./model-panel";
import { readSettings } from "./settings";

mountModelPanel();
async function setup(): Promise<void> {
  let settings = await readSettings();
  const paused = document.querySelector<HTMLInputElement>("#paused");
  const threshold = document.querySelector<HTMLInputElement>("#threshold");
  const output = document.querySelector<HTMLOutputElement>("#threshold-value");
  if (!paused || !threshold || !output) return;
  paused.checked = settings.paused;
  threshold.value = String(Math.round(settings.threshold * 100));
  output.value = `${threshold.value}%`;
  const save = (): void => {
    void chrome.storage.local
      .set({ settings })
      .catch(() => showError("Could not save settings. Change the setting again to retry."));
  };
  paused.addEventListener("change", () => {
    settings = { ...settings, paused: paused.checked };
    save();
  });
  threshold.addEventListener("input", () => {
    output.value = `${threshold.value}%`;
  });
  threshold.addEventListener("change", () => {
    settings = { ...settings, threshold: Number(threshold.value) / 100 };
    save();
  });
}
void setup().catch(() =>
  showError("Could not load settings. Reload Slop Spot in chrome://extensions and try again.")
);
