import * as ort from "onnxruntime-web/webgpu";
import { Tokenizer } from "@huggingface/tokenizers";
import { MODEL_ASSETS, MODEL_CACHE, MODEL_URL, TOTAL_BYTES, cacheKey } from "./model";
import { isRecord, isRequest } from "./protocol";
import type { ModelStatus, Reply, Request, Score } from "./protocol";
import { prepareText, sigmoid } from "./text";

ort.env.wasm.wasmPaths = new URL("../ort/", self.location.href).href;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.logLevel = "error";
let status: ModelStatus = {
  phase: "missing",
  downloaded: 0,
  total: TOTAL_BYTES,
  backend: "WebGPU · FP16",
  detail: "Download the model to score messages on this device.",
};
interface LoadedModel {
  readonly tokenizer: Tokenizer;
  readonly session: ort.InferenceSession;
}
let model: LoadedModel | undefined;
let downloadController: AbortController | undefined;
let queue: Promise<void> = Promise.resolve();
let queueSize = 0;

async function installed(): Promise<boolean> {
  const cache = await caches.open(MODEL_CACHE);
  for (const asset of MODEL_ASSETS) if (!(await cache.match(cacheKey(asset.path)))) return false;
  return true;
}
async function refreshStatus(): Promise<void> {
  if (status.phase !== "missing") return;
  const saved = await installed();
  if (saved && status.phase === "missing")
    status = {
      ...status,
      phase: "available",
      downloaded: TOTAL_BYTES,
      detail: "Model downloaded. Select Load model to prepare it for analysis.",
    };
}
async function download(): Promise<void> {
  if (await installed()) {
    await load();
    return;
  }
  const controller = new AbortController();
  downloadController = controller;
  status = {
    ...status,
    phase: "downloading",
    downloaded: 0,
    detail: "Downloading the model. Messages stay on this device.",
  };
  const cache = await caches.open(MODEL_CACHE);
  let completed = 0;
  try {
    for (const asset of MODEL_ASSETS) {
      const response = await fetch(`${MODEL_URL}/${asset.path}`, {
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok || !response.body)
        throw new Error("Could not download the model. Check your connection and try again.");
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let received = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        received += part.value.byteLength;
        if (received > asset.bytes) {
          await reader.cancel();
          throw new Error(
            "The downloaded model file is larger than expected. Download the model again."
          );
        }
        chunks.push(part.value);
        status = { ...status, downloaded: completed + received };
      }
      if (received !== asset.bytes)
        throw new Error("The model download is incomplete. Download the model again.");
      const bytes = await new Blob(chunks).arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
      if (hash !== asset.sha256)
        throw new Error(
          "The downloaded model file could not be verified. Download the model again."
        );
      controller.signal.throwIfAborted();
      await cache.put(cacheKey(asset.path), new Response(bytes));
      completed += received;
    }
    status = { ...status, phase: "available", downloaded: TOTAL_BYTES };
  } catch (error) {
    await caches.delete(MODEL_CACHE);
    throw error;
  } finally {
    downloadController = undefined;
  }
  await load();
}
async function cachedBytes(path: string): Promise<ArrayBuffer> {
  const response = await (await caches.open(MODEL_CACHE)).match(cacheKey(path));
  if (!response) throw new Error("Model files are missing. Download the model again.");
  return response.arrayBuffer();
}
async function cachedJson(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(new TextDecoder().decode(await cachedBytes(path)));
  if (!isRecord(value))
    throw new Error(
      "The model's text processing file could not be read. Delete the model, then download it again."
    );
  return value;
}
async function load(): Promise<LoadedModel> {
  if (model) return model;
  if (!(await installed()))
    throw new Error("Download the model in Slop Spot before analyzing text.");
  status = {
    ...status,
    phase: "loading",
    detail: "Loading the model on this device.",
  };
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter?.features.has("shader-f16"))
    throw new Error(
      "This model requires WebGPU FP16 support. Check Chrome's graphics acceleration setting, then reload Slop Spot."
    );
  const tokenizer = new Tokenizer(
    await cachedJson("tokenizer.json"),
    await cachedJson("tokenizer_config.json")
  );
  const session = await ort.InferenceSession.create(await cachedBytes("onnx/model_fp16.onnx"), {
    executionProviders: ["webgpu"],
    graphOptimizationLevel: "all",
    logSeverityLevel: 3,
  });
  model = { tokenizer, session };
  status = {
    ...status,
    phase: "ready",
    downloaded: TOTAL_BYTES,
    detail: "Model ready for analysis on this device.",
  };
  return model;
}
async function releaseModel(): Promise<void> {
  const loaded = model;
  model = undefined;
  await loaded?.session.release();
}
async function score(text: string): Promise<Score> {
  const { tokenizer, session } = await load();
  const started = performance.now();
  const encoded = tokenizer.encode(prepareText(text));
  const ids = encoded.ids.slice(0, 512);
  const output = await session.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
    attention_mask: new ort.Tensor(
      "int64",
      BigInt64Array.from(ids, () => 1n),
      [1, ids.length]
    ),
  });
  const logit = output.logits?.data[0];
  if (typeof logit !== "number" || !Number.isFinite(logit))
    throw new Error("Could not read a score from the model. Reload Slop Spot and try again.");
  return {
    value: sigmoid(logit),
    tokens: ids.length,
    truncated: encoded.ids.length > 512,
    elapsedMs: Math.round(performance.now() - started),
  };
}
async function execute(request: Request): Promise<Reply> {
  try {
    if (request.command === "download") await download();
    if (request.command === "delete") {
      await releaseModel();
      await caches.delete(MODEL_CACHE);
      status = {
        ...status,
        phase: "missing",
        downloaded: 0,
        detail: "Model deleted. Download it again to scan messages.",
      };
    }
    const result = request.command === "score" ? await score(request.text) : undefined;
    if (request.command === "download" || request.command === "delete")
      self.postMessage({ event: "model-state" });
    return result ? { ok: true, status, score: result } : { ok: true, status };
  } catch (error) {
    // A lost GPU session can also fail to release. Preserve the original error.
    await releaseModel().catch(() => undefined);
    return failure(error);
  }
}
function failure(error: unknown): Reply {
  const detail =
    error instanceof Error
      ? error.message
      : "Could not analyze the text. Reload Slop Spot in chrome://extensions and try again.";
  status = { ...status, phase: "error", detail };
  return { ok: false, error: detail };
}
self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (!isRecord(value) || typeof value.id !== "number" || !isRequest(value.request)) return;
  const { id, request } = value;
  if (request.command === "status") {
    void refreshStatus().then(
      () => self.postMessage({ id, reply: { ok: true, status } }),
      (error) => self.postMessage({ id, reply: failure(error) })
    );
    return;
  }
  if (request.command === "delete") downloadController?.abort();
  if (queueSize >= 32) {
    self.postMessage({
      id,
      reply: { ok: false, error: "The model is busy. Try again shortly." },
    });
    return;
  }
  queueSize++;
  queue = queue
    .then(async () => {
      self.postMessage({ id, reply: await execute(request) });
    })
    .finally(() => {
      queueSize--;
    });
});
