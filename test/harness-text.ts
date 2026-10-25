/**
 * Text helpers shared by the harness: reading a message's text out of pi's union of content
 * shapes, and recognising the one request that is not a turn — pi's compaction summarizer.
 */
import type { Message, TranscriptContext } from "@earendil-works/pi-ai";

/** Text of a message's text blocks, or its string content, for assertions. */
export function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Whether `context` is pi's summary request: one user message whose text opens with
 * `<conversation>`. Identifying the call this way lets the harness queue a canned summary
 * without depending on the prompt wording beyond that tag.
 */
export function isSummarizationRequest(context: TranscriptContext): boolean {
  const only = context.messages.length === 1 ? context.messages[0] : undefined;
  return only?.role === "user" && messageText(only).startsWith("<conversation>");
}
