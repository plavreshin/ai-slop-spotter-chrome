import { francAll } from "franc-min";

export function prepareText(text: string): string {
  return text
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/gu, "```\n```")
    .replace(/```[^`]*```/gu, "```\n```")
    .trim();
}
function proseText(text: string): string {
  return prepareText(text)
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/```/gu, "")
    .trim();
}
export function wordCount(text: string): number {
  return countProseWords(proseText(text));
}
function countProseWords(prose: string): number {
  return (prose.match(/\p{L}+(?:['’-]\p{L}+)*/gu) ?? []).length;
}
export function eligible(text: string): boolean {
  const prose = proseText(text);
  if (!/\p{L}/u.test(prose)) return false;
  const languages = francAll(prose, { minLength: 10 });
  if (countProseWords(prose) >= 50) return languages[0]?.[0] === "eng";
  // Short text and names make the top language unreliable; retain plausible English.
  return (
    languages.slice(0, 5).some(([language]) => language === "eng") ||
    (languages[0]?.[0] === "und" && /^\p{ASCII}+$/u.test(prose))
  );
}
export function sigmoid(logit: number): number {
  return logit >= 0 ? 1 / (1 + Math.exp(-logit)) : Math.exp(logit) / (1 + Math.exp(logit));
}
