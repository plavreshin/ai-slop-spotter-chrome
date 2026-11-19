import { afterEach, expect, it, vi } from "vitest";
import type { Reply, Request } from "../src/protocol";

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (reply: Reply) => void
) => boolean;
class WorkerDouble extends EventTarget {
  readonly postMessage = vi.fn<(message: { id: number; request: Request }) => void>();
  readonly terminate = vi.fn();
}

async function setup() {
  vi.resetModules();
  vi.useFakeTimers();
  const worker = new WorkerDouble();
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        return worker;
      }
    }
  );
  let listener: Listener = () => {
    throw new Error("Listener not initialized");
  };
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("chrome", {
    runtime: {
      id: "slop",
      sendMessage,
      onMessage: {
        addListener: (callback: Listener) => {
          listener = callback;
        },
      },
    },
  });
  await import("../src/offscreen");
  return {
    worker,
    sendMessage,
    receive: (
      message: Request,
      sender: chrome.runtime.MessageSender,
      reply: (reply: Reply) => void
    ) => listener(message, sender, reply),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("refreshes background readiness when model work finishes without the original request", async () => {
  const { worker, sendMessage } = await setup();
  worker.dispatchEvent(new MessageEvent("message", { data: { event: "model-state" } }));
  expect(sendMessage).toHaveBeenCalledWith({ target: "background", command: "status" });
  expect(worker.postMessage).not.toHaveBeenCalled();
});

it("routes valid background requests and ignores requests from another extension", async () => {
  const { worker, receive } = await setup();
  const reply = vi.fn<(reply: Reply) => void>();
  const request: Request = { target: "offscreen", command: "status" };
  expect(receive(request, { id: "other" }, reply)).toBe(false);
  expect(worker.postMessage).not.toHaveBeenCalled();
  expect(receive(request, { id: "slop" }, reply)).toBe(true);
  const sent = worker.postMessage.mock.calls[0]?.[0];
  if (!sent) throw new Error("Worker request missing");
  const result: Reply = {
    ok: true,
    status: { phase: "ready", downloaded: 1, total: 1, backend: "test", detail: "Ready" },
  };
  worker.dispatchEvent(new MessageEvent("message", { data: { id: sent.id, reply: result } }));
  await vi.advanceTimersByTimeAsync(0);
  expect(reply).toHaveBeenCalledWith(result);
  expect(vi.getTimerCount()).toBe(0);
});
