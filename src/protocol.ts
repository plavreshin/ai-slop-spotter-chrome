const COMMANDS = ["status", "download", "delete", "score"] as const;
const MODEL_PHASES = ["missing", "available", "downloading", "loading", "ready", "error"] as const;
export type Command = (typeof COMMANDS)[number];
export type Request = {
  readonly target: "background" | "offscreen";
} & (
  | { readonly command: "score"; readonly text: string }
  | { readonly command: Exclude<Command, "score"> }
);
export interface ModelStatus {
  readonly phase: (typeof MODEL_PHASES)[number];
  readonly downloaded: number;
  readonly total: number;
  readonly backend: string;
  readonly detail: string;
}
export interface Score {
  readonly value: number;
  readonly tokens: number;
  readonly truncated: boolean;
  readonly elapsedMs: number;
}
export type Reply =
  | { readonly ok: true; readonly status: ModelStatus; readonly score?: Score }
  | { readonly ok: false; readonly error: string };
export const INVALID_MODEL_RESPONSE =
  "Could not read the model response. Reload Slop Spot in chrome://extensions and try again.";
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isModelStatus(value: unknown): value is ModelStatus {
  if (!isRecord(value)) return false;
  return (
    MODEL_PHASES.some((phase) => phase === value.phase) &&
    isFiniteNumber(value.downloaded) &&
    isFiniteNumber(value.total) &&
    value.total > 0 &&
    value.downloaded >= 0 &&
    value.downloaded <= value.total &&
    typeof value.backend === "string" &&
    typeof value.detail === "string"
  );
}
function isScore(value: unknown): value is Score {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.value) &&
    value.value >= 0 &&
    value.value <= 1 &&
    isFiniteNumber(value.tokens) &&
    Number.isInteger(value.tokens) &&
    value.tokens >= 1 &&
    value.tokens <= 512 &&
    typeof value.truncated === "boolean" &&
    isFiniteNumber(value.elapsedMs) &&
    value.elapsedMs >= 0
  );
}
export function isRequest(value: unknown): value is Request {
  return (
    isRecord(value) &&
    (value.target === "background" || value.target === "offscreen") &&
    COMMANDS.some((command) => command === value.command) &&
    (value.command !== "score" ||
      (typeof value.text === "string" && value.text.length > 0 && value.text.length <= 100_000))
  );
}
export function isReply(value: unknown): value is Reply {
  if (!isRecord(value)) return false;
  if (value.ok === false) return typeof value.error === "string";
  return (
    value.ok === true &&
    isModelStatus(value.status) &&
    (value.score === undefined || isScore(value.score))
  );
}
export function request(command: "score", text: string): Promise<Reply>;
export function request(command: Exclude<Command, "score">): Promise<Reply>;
export async function request(command: Command, text?: string): Promise<Reply> {
  let message: Request;
  if (command === "score") {
    if (text === undefined) throw new Error("Text is required for scoring.");
    message = { target: "background", command, text };
  } else {
    message = { target: "background", command };
  }
  const reply: unknown = await chrome.runtime.sendMessage(message);
  if (!isReply(reply)) throw new Error(INVALID_MODEL_RESPONSE);
  return reply;
}
