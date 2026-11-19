import { request } from "./protocol";
import type { ModelStatus } from "./protocol";

export function showError(message: string): void {
  const notice = document.querySelector<HTMLElement>("#notice");
  if (notice) {
    notice.textContent = message;
    notice.hidden = false;
  }
}
const PHASE_LABELS: Record<ModelStatus["phase"], string> = {
  missing: "Not downloaded",
  available: "Downloaded",
  downloading: "Downloading",
  loading: "Loading",
  ready: "Ready",
  error: "Needs attention",
};

export function mountModelPanel(): void {
  const phase = document.querySelector<HTMLElement>("#phase");
  const detail = document.querySelector<HTMLElement>("#model-detail");
  const progress = document.querySelector<HTMLProgressElement>("#progress");
  const download = document.querySelector<HTMLButtonElement>("#download");
  const remove = document.querySelector<HTMLButtonElement>("#delete");
  if (!phase || !detail || !progress || !download || !remove)
    throw new Error("The model controls are missing.");
  const render = (status: ModelStatus): void => {
    phase.textContent = PHASE_LABELS[status.phase];
    if (status.phase === "ready") {
      const notice = document.querySelector<HTMLElement>("#notice");
      if (notice) notice.hidden = true;
    }
    detail.textContent = status.detail;
    progress.hidden = status.phase !== "downloading";
    progress.value = status.total ? (status.downloaded / status.total) * 100 : 0;
    if (status.phase === "downloading")
      detail.textContent = `Downloading ${Math.floor(status.downloaded / 1e6)} of ${Math.ceil(status.total / 1e6)} MB. Messages stay on this device.`;
    download.hidden = status.phase === "ready";
    download.disabled = status.phase === "downloading" || status.phase === "loading";
    download.textContent =
      status.phase === "available" ||
      (status.phase === "error" && status.downloaded === status.total)
        ? "Load model"
        : "Download model · 761 MB";
    remove.hidden = status.phase === "missing";
    remove.disabled = status.phase === "loading";
  };
  let polling = false;
  async function refresh(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const reply = await request("status");
      if (reply.ok) render(reply.status);
      else showError(reply.error);
    } catch {
      showError("Slop Spot is not responding. Reload it in chrome://extensions and try again.");
    } finally {
      polling = false;
    }
  }
  download.addEventListener("click", () => {
    download.disabled = true;
    void request("download")
      .then(
        (reply) => {
          if (reply.ok) render(reply.status);
          else showError(reply.error);
        },
        () => showError("Model setup was interrupted. Open Slop Spot again to check its progress.")
      )
      .finally(() => {
        void refresh();
      });
  });
  remove.addEventListener("click", () => {
    remove.disabled = true;
    void request("delete")
      .then(
        (reply) => {
          if (reply.ok) render(reply.status);
          else showError(reply.error);
        },
        () => showError("Could not delete the model. Reload Slop Spot and try again.")
      )
      .finally(() => {
        remove.disabled = false;
        void refresh();
      });
  });
  void refresh();
  const timer = setInterval(() => {
    void refresh();
  }, 1000);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
}
