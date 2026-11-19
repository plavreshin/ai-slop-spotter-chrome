import { INVALID_MODEL_RESPONSE, isRecord, isReply } from "./protocol";
import type { Reply, Request } from "./protocol";

interface PendingRequest {
  readonly resolve: (reply: Reply) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export function createWorkerClient(worker: Worker): (request: Request) => Promise<Reply> {
  const pending = new Map<number, PendingRequest>();
  let nextId = 0;
  let stopped = false;
  const stoppedReply: Reply = {
    ok: false,
    error: "Analysis stopped. Reload Slop Spot in chrome://extensions and try again.",
  };

  function finish(id: number, reply: Reply): void {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(reply);
  }

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (!isRecord(data) || typeof data.id !== "number") return;
    const reply: Reply = isReply(data.reply)
      ? data.reply
      : {
          ok: false,
          error: INVALID_MODEL_RESPONSE,
        };
    finish(data.id, reply);
  });
  worker.addEventListener("error", () => {
    stopped = true;
    worker.terminate();
    for (const id of pending.keys()) finish(id, stoppedReply);
  });

  return (request) => {
    if (stopped) return Promise.resolve(stoppedReply);
    return new Promise((resolve) => {
      const id = ++nextId;
      const timeoutMs = request.command === "download" ? 15 * 60_000 : 120_000;
      const timer = setTimeout(
        () =>
          finish(id, {
            ok: false,
            error:
              "Local analysis timed out. Reload Slop Spot in chrome://extensions and try again.",
          }),
        timeoutMs
      );
      pending.set(id, { resolve, timer });
      try {
        worker.postMessage({ id, request });
      } catch {
        finish(id, stoppedReply);
      }
    });
  };
}
