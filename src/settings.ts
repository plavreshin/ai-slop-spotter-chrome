import { isRecord } from "./protocol";

export interface Settings {
  readonly paused: boolean;
  readonly threshold: number;
}
export const DEFAULT_SETTINGS: Settings = {
  paused: false,
  threshold: 0.75,
};
export function clientPathFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://app.slack.com" &&
      /^\/client\/[^/]+(?:\/|$)/u.test(parsed.pathname)
      ? parsed.pathname
      : undefined;
  } catch {
    return undefined;
  }
}
export function parseSettings(value: unknown): Settings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  return {
    paused: typeof value.paused === "boolean" ? value.paused : DEFAULT_SETTINGS.paused,
    threshold:
      typeof value.threshold === "number" && Number.isFinite(value.threshold)
        ? Math.max(0.15, Math.min(0.99, value.threshold))
        : DEFAULT_SETTINGS.threshold,
  };
}
export async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get("settings");
  return parseSettings(stored.settings);
}
export function enabled(settings: Settings, clientPath: string | undefined): boolean {
  return !settings.paused && clientPath !== undefined;
}
