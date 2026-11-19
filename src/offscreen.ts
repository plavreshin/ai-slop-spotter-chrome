import { isRecord, isRequest } from "./protocol";
import { createWorkerClient } from "./worker-client";

const worker = new Worker(new URL("./inference.worker.ts", import.meta.url), { type: "module" });
const callWorker = createWorkerClient(worker);
worker.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isRecord(event.data) || event.data.event !== "model-state") return;
  // A download can finish after Chrome has stopped its original background request.
  void chrome.runtime
    .sendMessage({ target: "background", command: "status" })
    .catch(() => undefined);
});
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (
    !isRequest(message) ||
    message.target !== "offscreen" ||
    sender.id !== chrome.runtime.id ||
    sender.tab
  )
    return false;
  void callWorker(message).then(sendResponse);
  return true;
});
