import { afterEach, expect, it, vi } from "vitest";
import type { Reply, Request } from "../src/protocol";
import { DEFAULT_SETTINGS } from "../src/settings";

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (reply: Reply) => void
) => boolean;
const sender: chrome.runtime.MessageSender = {
  id: "slop",
  url: "chrome-extension://slop/popup.html",
};
const ready: Reply = {
  ok: true,
  status: { phase: "ready", downloaded: 1, total: 1, backend: "test", detail: "Ready" },
};
const slackTab: chrome.tabs.Tab = {
  id: 1,
  index: 0,
  pinned: false,
  highlighted: false,
  windowId: 1,
  active: true,
  incognito: false,
  selected: true,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  frozen: false,
  lastAccessed: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup(modelReady = false) {
  vi.resetModules();
  const stored: Record<string, unknown> = { modelReady, settings: DEFAULT_SETTINGS };
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(stored, values);
    }),
  };
  let listener: Listener = () => {
    throw new Error("Background listener not installed");
  };
  const runtime = {
    id: "slop",
    getURL: (path: string) => `chrome-extension://slop/${path}`,
    ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
    getContexts: vi.fn(async () => []),
    sendMessage: vi.fn<(request: Request) => Promise<unknown>>().mockResolvedValue(ready),
    onMessage: {
      addListener: (callback: Listener) => {
        listener = callback;
      },
    },
  };
  const offscreen = { Reason: { WORKERS: "WORKERS" }, createDocument: vi.fn(async () => {}) };
  vi.stubGlobal("chrome", { runtime, offscreen, storage: { local: storage } });
  await import("../src/background");
  function send(request: Request, from = sender): Promise<Reply> {
    return new Promise((resolve) => {
      if (!listener(request, from, resolve)) throw new Error("Request was not handled");
    });
  }
  return { send, runtime, offscreen, storage, stored };
}

it("restores readiness from the model after a download's original request was lost", async () => {
  const background = await setup(false);
  await background.send({ target: "background", command: "status" });
  expect(background.stored.modelReady).toBe(true);
  await background.send({ target: "background", command: "status" });
  expect(background.storage.set).toHaveBeenCalledOnce();
});

it("turns readiness off if the worker reports missing model files", async () => {
  const background = await setup(true);
  background.runtime.sendMessage.mockResolvedValue({
    ok: true,
    status: { ...ready.status, phase: "missing", downloaded: 0 },
  });
  await background.send({ target: "background", command: "status" });
  expect(background.stored.modelReady).toBe(false);
});

it("does not interrupt readiness during a transient loading status", async () => {
  const background = await setup(true);
  background.runtime.sendMessage.mockResolvedValue({
    ok: true,
    status: { ...ready.status, phase: "loading" },
  });
  await background.send({ target: "background", command: "status" });
  expect(background.stored.modelReady).toBe(true);
  expect(background.storage.set).not.toHaveBeenCalled();
});

it("creates only one offscreen document for concurrent requests", async () => {
  const background = await setup(true);
  await Promise.all([
    background.send({ target: "background", command: "status" }),
    background.send({ target: "background", command: "status" }),
  ]);
  expect(background.offscreen.createDocument).toHaveBeenCalledOnce();
});

it("prevents Slack content scripts from downloading or deleting the model", async () => {
  const background = await setup(true);
  const slack: chrome.runtime.MessageSender = {
    id: "slop",
    url: "https://app.slack.com/client/example/channel",
    tab: slackTab,
  };
  for (const command of ["download", "delete"] satisfies Request["command"][]) {
    expect(await background.send({ target: "background", command }, slack)).toMatchObject({
      ok: false,
    });
  }
  expect(background.runtime.sendMessage).not.toHaveBeenCalled();
  expect(background.storage.set).not.toHaveBeenCalled();
});

it("rejects scores from unsupported pages", async () => {
  const background = await setup(true);
  const slack: chrome.runtime.MessageSender = {
    id: "slop",
    url: "https://example.com/client/example/channel",
    tab: slackTab,
  };
  expect(
    await background.send({ target: "background", command: "score", text: "Hello" }, slack)
  ).toMatchObject({ ok: false });
  expect(background.runtime.sendMessage).not.toHaveBeenCalled();
});

it("forwards scores from supported Slack pages to the inference worker", async () => {
  const background = await setup(true);
  const slack: chrome.runtime.MessageSender = {
    id: "slop",
    url: "https://app.slack.com/client/example/channel",
    tab: slackTab,
  };
  await background.send({ target: "background", command: "score", text: "Hello" }, slack);
  expect(background.runtime.sendMessage).toHaveBeenCalledWith({
    target: "offscreen",
    command: "score",
    text: "Hello",
  });
});

it("rejects scores while scanning is paused", async () => {
  const background = await setup(true);
  background.stored.settings = { ...DEFAULT_SETTINGS, paused: true };
  const slack: chrome.runtime.MessageSender = {
    id: "slop",
    url: "https://app.slack.com/client/example/channel",
    tab: slackTab,
  };
  expect(
    await background.send({ target: "background", command: "score", text: "Hello" }, slack)
  ).toMatchObject({ ok: false });
  expect(background.runtime.sendMessage).not.toHaveBeenCalled();
});
