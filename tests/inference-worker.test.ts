import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MODEL_ASSETS, MODEL_URL, cacheKey } from "../src/model";
import type { Reply, Request } from "../src/protocol";

const runtime = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), release: vi.fn() }));
vi.mock("onnxruntime-web/webgpu", () => ({
  env: { wasm: {}, logLevel: "warning" },
  InferenceSession: { create: runtime.create },
  Tensor: class {
    constructor(
      readonly type: string,
      readonly data: BigInt64Array,
      readonly dims: number[]
    ) {}
  },
}));
vi.mock("@huggingface/tokenizers", () => ({
  Tokenizer: class {
    encode() {
      return { ids: [0, 1] };
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  runtime.run.mockReset().mockResolvedValue({ logits: { data: Float32Array.of(0) } });
  runtime.release.mockReset().mockResolvedValue(undefined);
  runtime.create
    .mockReset()
    .mockImplementation(async () => ({ run: runtime.run, release: runtime.release }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup(saved = true) {
  const files = new Map<string, Response>();
  if (saved)
    for (const asset of MODEL_ASSETS)
      files.set(cacheKey(asset.path), new Response(asset.path.endsWith(".json") ? "{}" : "graph"));
  const cache = {
    match: vi.fn(async (key: string) => files.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      files.set(key, response.clone());
    }),
  };
  const storage = {
    open: vi.fn(async () => cache),
    delete: vi.fn(async () => {
      files.clear();
      return true;
    }),
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new Error("Unexpected network request"));
  const postMessage =
    vi.fn<(message: { id: number; reply: Reply } | { event: "model-state" }) => void>();
  let listener: (event: MessageEvent<unknown>) => void = () => {
    throw new Error("Worker not initialized");
  };
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("navigator", {
    gpu: { requestAdapter: async () => ({ features: new Set(["shader-f16"]) }) },
  });
  vi.stubGlobal("self", {
    location: new URL("https://extension.test/assets/inference.worker.js"),
    addEventListener: (_name: string, callback: typeof listener) => {
      listener = callback;
    },
    postMessage,
  });
  await import("../src/inference.worker");
  let nextId = 0;
  function dispatch(request: Request): number {
    const id = ++nextId;
    listener(new MessageEvent("message", { data: { id, request } }));
    return id;
  }
  async function receive(id: number): Promise<Reply> {
    await vi.waitFor(() =>
      expect(postMessage.mock.calls.some(([message]) => "id" in message && message.id === id)).toBe(
        true
      )
    );
    const message = postMessage.mock.calls.find(
      ([message]) => "id" in message && message.id === id
    )?.[0];
    if (!message || !("reply" in message)) throw new Error("Missing worker reply");
    return message.reply;
  }
  async function send(request: Request): Promise<Reply> {
    return receive(dispatch(request));
  }
  return { cache, storage, files, fetch, dispatch, receive, send };
}

const scoreRequest: Request = { target: "offscreen", command: "score", text: "Hello" };

it("scores cached models without a network request and reuses the loaded session", async () => {
  const worker = await setup();
  expect(await worker.send(scoreRequest)).toMatchObject({
    ok: true,
    status: { phase: "ready" },
    score: { value: 0.5, tokens: 2 },
  });
  expect(await worker.send(scoreRequest)).toMatchObject({ ok: true });
  expect(runtime.create).toHaveBeenCalledOnce();
  expect(worker.fetch).not.toHaveBeenCalled();
});

it("discards a failed session so the next analysis can load a fresh one", async () => {
  const worker = await setup();
  runtime.run.mockRejectedValueOnce(new Error("GPU device lost"));
  runtime.release.mockRejectedValueOnce(new Error("GPU already unavailable"));
  expect(await worker.send(scoreRequest)).toEqual({ ok: false, error: "GPU device lost" });
  expect(await worker.send(scoreRequest)).toMatchObject({ ok: true, status: { phase: "ready" } });
  expect(runtime.create).toHaveBeenCalledTimes(2);
  expect(runtime.release).toHaveBeenCalledOnce();
});

it("removes partial downloads and never creates a session from incomplete files", async () => {
  const worker = await setup(false);
  worker.fetch.mockResolvedValueOnce(new Response("{}"));
  expect(await worker.send({ target: "offscreen", command: "download" })).toMatchObject({
    ok: false,
    error: expect.stringContaining("incomplete"),
  });
  expect(worker.storage.delete).toHaveBeenCalledOnce();
  expect(worker.files.size).toBe(0);
  expect(runtime.create).not.toHaveBeenCalled();
  expect(worker.fetch).toHaveBeenCalledWith(
    `${MODEL_URL}/tokenizer.json`,
    expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" })
  );
});

it("rejects a file with the right size but the wrong checksum", async () => {
  const worker = await setup(false);
  const asset = MODEL_ASSETS[0];
  worker.fetch.mockResolvedValueOnce(new Response(new Uint8Array(asset.bytes)));
  expect(await worker.send({ target: "offscreen", command: "download" })).toMatchObject({
    ok: false,
    error: expect.stringContaining("could not be verified"),
  });
  expect(worker.cache.put).not.toHaveBeenCalled();
  expect(worker.files.size).toBe(0);
  expect(runtime.create).not.toHaveBeenCalled();
});

it("releases the active session and removes model files on deletion", async () => {
  const worker = await setup();
  await worker.send(scoreRequest);
  expect(await worker.send({ target: "offscreen", command: "delete" })).toMatchObject({
    ok: true,
    status: { phase: "missing", downloaded: 0 },
  });
  expect(runtime.release).toHaveBeenCalledOnce();
  expect(worker.files.size).toBe(0);
  expect(await worker.send(scoreRequest)).toMatchObject({ ok: false });
  expect(runtime.create).toHaveBeenCalledOnce();
});

it("answers status requests when cache access rejects", async () => {
  const worker = await setup();
  worker.storage.open.mockRejectedValueOnce(new Error("Storage unavailable"));
  expect(await worker.send({ target: "offscreen", command: "status" })).toEqual({
    ok: false,
    error: "Storage unavailable",
  });
});

it("does not let a slow cache-status check overwrite a newer ready state", async () => {
  const worker = await setup();
  let releaseLookup: (response: Response | undefined) => void = () => {
    throw new Error("Lookup not started");
  };
  worker.cache.match.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseLookup = resolve;
      })
  );
  const statusId = worker.dispatch({ target: "offscreen", command: "status" });
  await vi.waitFor(() => expect(worker.cache.match).toHaveBeenCalledOnce());
  expect(await worker.send(scoreRequest)).toMatchObject({ ok: true, status: { phase: "ready" } });
  releaseLookup(worker.files.get(cacheKey(MODEL_ASSETS[0].path))?.clone());
  expect(await worker.receive(statusId)).toMatchObject({ ok: true, status: { phase: "ready" } });
});

it("runs scoring requests sequentially through one model session", async () => {
  const worker = await setup();
  let finishRun: (result: { logits: { data: Float32Array } }) => void = () => {
    throw new Error("Run not started");
  };
  runtime.run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRun = resolve;
      })
  );
  const first = worker.dispatch(scoreRequest);
  const second = worker.dispatch(scoreRequest);
  await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce());
  finishRun({ logits: { data: Float32Array.of(0) } });
  expect(await worker.receive(first)).toMatchObject({ ok: true });
  expect(await worker.receive(second)).toMatchObject({ ok: true });
  expect(runtime.run).toHaveBeenCalledTimes(2);
  expect(runtime.create).toHaveBeenCalledOnce();
});
