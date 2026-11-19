export const ROW_SELECTOR = ".c-message_kit__message";
export function messageText(row: Element): string {
  const body = row.querySelector(
    '.c-message_kit__blocks, [data-qa="message-text"], .c-message__body'
  );
  if (!body) return "";
  const clone = body.cloneNode(true);
  if (!(clone instanceof Element)) return "";
  for (const element of clone.querySelectorAll('pre, .c-mrkdwn__pre, [data-stringify-type="pre"]'))
    element.replaceWith("\n```\n```\n");
  for (const element of clone.querySelectorAll(
    ".slop-spot-host, .c-message_kit__attachments, .c-unfurl, button, img, video"
  ))
    element.remove();
  for (const element of clone.querySelectorAll("br")) element.replaceWith("\n");
  for (const element of clone.querySelectorAll("p, li, .p-rich_text_section")) element.append("\n");
  return (clone.textContent ?? "").trim().slice(0, 100_000);
}
export function placeBadge(row: Element, badge: HTMLElement): void {
  const timestamp = row.querySelector(".c-message_kit__gutter__right > .c-timestamp");
  if (timestamp) {
    timestamp.after(badge);
    return;
  }
  const header = row.querySelector(".c-message_kit__header");
  if (header) {
    header.append(badge);
    return;
  }
  const body = row.querySelector(".c-message_kit__blocks");
  if (body) body.before(badge);
  else row.prepend(badge);
}
