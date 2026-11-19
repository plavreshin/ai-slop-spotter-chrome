import { INVALID_MODEL_RESPONSE, isRequest, isReply } from "./protocol";
import type { ModelStatus, Reply, Request } from "./protocol";
import { enabled, readSettings, clientPathFromUrl } from "./settings";

let creating: Promise<void> | undefined;
async function ensureOffscreen(): Promise<void> {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL("offscreen.html")],
    });
    if (!contexts.length)
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
          "Run local ONNX inference in a dedicated worker without uploading Slack messages.",
      });
  })();
  try {
    await creating;
  } finally {
    creating = undefined;
  }
}
async function route(message: Request, sender: chrome.runtime.MessageSender): Promise<Reply> {
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL("")) === true;
  if (
    !extensionPage &&
    (!sender.tab ||
      message.command !== "score" ||
      !enabled(await readSettings(), clientPathFromUrl(sender.url ?? "")))
  )
    return {
      ok: false,
      error: "Open a Slack conversation and turn off Pause scanning in Slop Spot.",
    };
  if (message.command === "delete" || message.command === "download")
    await chrome.storage.local.set({ modelReady: false });
  await ensureOffscreen();
  const reply: unknown = await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
  if (!isReply(reply)) return { ok: false, error: INVALID_MODEL_RESPONSE };
  if (message.command === "status" && reply.ok) await synchronizeModelReady(reply.status);
  return reply;
}
async function synchronizeModelReady(status: ModelStatus): Promise<void> {
  if (status.phase !== "ready" && status.phase !== "available" && status.phase !== "missing")
    return;
  const modelReady = status.phase !== "missing";
  const stored = await chrome.storage.local.get("modelReady");
  if (stored.modelReady !== modelReady) await chrome.storage.local.set({ modelReady });
}
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRequest(message) || message.target !== "background" || sender.id !== chrome.runtime.id)
    return false;
  void route(message, sender).then(sendResponse, () =>
    sendResponse({
      ok: false,
      error: "The model is not responding. Reload Slop Spot in chrome://extensions and try again.",
    })
  );
  return true;
});
