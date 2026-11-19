import { afterEach, expect, it, vi } from "vitest";
import { createWorkerClient } from "../src/worker-client";
import type { Reply, Request } from "../src/protocol";

const ready: Reply = {
  ok: true,
  status: { phase: "ready", downloaded: 1, total: 1, backend: "test", detail: "Ready" },
};

class WorkerDouble extends EventTarget {
  readonly postMessage = vi.fn<(message: { id: number; request: Request }) => void>();
  readonly terminate = vi.fn();
  reply(index: number, reply: unknown): void {
    const sent = this.postMessage.mock.calls[index]?.[0];
    if (!sent) throw new Error("No worker request at that index");
    this.dispatchEvent(new MessageEvent("message", { data: { id: sent.id, reply } }));
  }
}

function setup() {
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
  return { worker, call: createWorkerClient(new Worker("/inference.worker.js")) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("routes out-of-order replies and clears completed request timers", async () => {
  const { worker, call } = setup();
  const first = call({ target: "offscreen", command: "status" });
  const second = call({ target: "offscreen", command: "score", text: "Hello" });
  const scored: Reply = {
    ...ready,
    score: { value: 0.12, tokens: 2, truncated: false, elapsedMs: 10 },
  };
  worker.reply(1, scored);
  worker.reply(0, ready);
  expect(await first).toEqual(ready);
  expect(await second).toEqual(scored);
  expect(vi.getTimerCount()).toBe(0);
});

it("fails pending and future calls immediately after a worker crash", async () => {
  const { worker, call } = setup();
  const pending = call({ target: "offscreen", command: "score", text: "Hello" });
  worker.dispatchEvent(new Event("error"));
  expect(await pending).toMatchObject({ ok: false });
  expect(await call({ target: "offscreen", command: "status" })).toMatchObject({ ok: false });
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("times out unanswered calls and ignores their late replies", async () => {
  const { worker, call } = setup();
  const pending = call({ target: "offscreen", command: "status" });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining("timed out") });
  worker.reply(0, ready);
  expect(vi.getTimerCount()).toBe(0);
});

it("allows longer for model downloads but still bounds the wait", async () => {
  const { call } = setup();
  let completed = false;
  const pending = call({ target: "offscreen", command: "download" });
  void pending.then(() => {
    completed = true;
  });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(13 * 60_000);
  expect(await pending).toMatchObject({ ok: false });
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects malformed replies without waiting for a timeout", async () => {
  const { worker, call } = setup();
  const pending = call({ target: "offscreen", command: "status" });
  worker.reply(0, { ok: true, status: { phase: "ready" } });
  expect(await pending).toMatchObject({ ok: false });
  expect(vi.getTimerCount()).toBe(0);
});

it("cleans up when posting to the worker throws", async () => {
  const { worker, call } = setup();
  worker.postMessage.mockImplementationOnce(() => {
    throw new Error("Worker is unavailable");
  });
  expect(await call({ target: "offscreen", command: "status" })).toMatchObject({ ok: false });
  expect(vi.getTimerCount()).toBe(0);
});
