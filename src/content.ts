import { createBadge } from "./badge";
import { request } from "./protocol";
import type { Score } from "./protocol";
import { DEFAULT_SETTINGS, enabled, readSettings, clientPathFromUrl } from "./settings";
import type { Settings } from "./settings";
import { placeBadge, messageText, ROW_SELECTOR } from "./slack";
import { eligible, wordCount } from "./text";

interface RowState {
  text: string;
  page: string;
  score?: Score;
  badge?: HTMLElement;
}
let settings: Settings = DEFAULT_SETTINGS;
let modelReady = false;
let generation = 0;
let running = false;
let retryAfter = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let currentPage = clientPathFromUrl(location.href);
const states = new WeakMap<Element, RowState>();
const visible = new Set<Element>();
const observed = new Set<Element>();
const intersections = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) visible.add(entry.target);
    else {
      visible.delete(entry.target);
      states.get(entry.target)?.badge?.remove();
      states.delete(entry.target);
    }
  }
  schedule();
});
function active(): boolean {
  return (
    modelReady &&
    currentPage === clientPathFromUrl(location.href) &&
    enabled(settings, currentPage) &&
    !document.hidden
  );
}
function clearBadges(): void {
  for (const row of observed) {
    const state = states.get(row);
    state?.badge?.remove();
    if (state) delete state.badge;
  }
}
function render(row: Element, state: RowState): void {
  state.badge?.remove();
  delete state.badge;
  if (!active() || !visible.has(row) || !state.score) return;
  state.badge = createBadge(state.score, settings.threshold, wordCount(state.text) < 50);
  placeBadge(row, state.badge);
}
function schedule(): void {
  if (scheduled) return;
  scheduled = setTimeout(() => {
    scheduled = undefined;
    reconcile();
    void scan();
  }, 300);
}
function reconcile(): void {
  const page = clientPathFromUrl(location.href);
  if (page !== currentPage) {
    generation++;
    clearBadges();
    currentPage = page;
  }
  for (const row of observed) {
    if (!row.isConnected) {
      intersections.unobserve(row);
      observed.delete(row);
      visible.delete(row);
      states.delete(row);
    }
  }
  for (const row of document.querySelectorAll(ROW_SELECTOR)) {
    if (!observed.has(row)) {
      observed.add(row);
      intersections.observe(row);
    }
  }
  if (!active()) {
    clearBadges();
    return;
  }
  for (const row of visible) {
    const state = states.get(row);
    if (state && (state.page !== currentPage || state.text !== messageText(row))) {
      state.badge?.remove();
      states.delete(row);
      continue;
    }
    if (state?.score && !state.badge?.isConnected) render(row, state);
  }
}
function retryLater(): void {
  retryAfter = performance.now() + 30_000;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(schedule, 30_000);
}
async function scan(): Promise<void> {
  if (running || !active() || performance.now() < retryAfter) return;
  running = true;
  try {
    for (const row of visible) {
      if (!active()) break;
      if (!row.isConnected || states.has(row)) continue;
      const page = currentPage;
      if (!page) break;
      const text = messageText(row);
      const state: RowState = { text, page };
      states.set(row, state);
      if (!eligible(text)) continue;
      const startedGeneration = generation;
      const reply = await request("score", text).catch(() => undefined);
      if (!reply?.ok || !reply.score) {
        states.delete(row);
        retryLater();
        break;
      }
      if (
        startedGeneration !== generation ||
        !visible.has(row) ||
        !row.isConnected ||
        currentPage !== page ||
        states.get(row) !== state ||
        messageText(row) !== text
      ) {
        states.delete(row);
        continue;
      }
      state.score = reply.score;
      render(row, state);
    }
  } catch {
    retryLater();
  } finally {
    running = false;
    if (active() && performance.now() >= retryAfter && [...visible].some((row) => !states.has(row)))
      schedule();
  }
}
async function start(): Promise<void> {
  settings = await readSettings();
  const stored = await chrome.storage.local.get("modelReady");
  modelReady = stored.modelReady === true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || (!changes.settings && !changes.modelReady)) return;
    generation++;
    clearBadges();
    void Promise.all([readSettings(), chrome.storage.local.get("modelReady")]).then(
      ([nextSettings, nextStored]) => {
        settings = nextSettings;
        modelReady = nextStored.modelReady === true;
        retryAfter = 0;
        for (const row of observed) {
          const state = states.get(row);
          if (state?.score && modelReady) render(row, state);
          else states.delete(row);
        }
        schedule();
      }
    );
  });
  const mutations = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          !(
            record.target instanceof Element ? record.target : record.target.parentElement
          )?.closest(".slop-spot-host") &&
          !(
            record.type === "childList" &&
            record.removedNodes.length === 0 &&
            [...record.addedNodes].every(
              (node) => node instanceof Element && node.classList.contains("slop-spot-host")
            )
          )
      )
    )
      schedule();
  });
  mutations.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["data-message-id", "data-item-key"],
  });
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("popstate", schedule);
  schedule();
}
void start();
