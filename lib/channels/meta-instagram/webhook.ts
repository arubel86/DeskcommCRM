import { createHmac, timingSafeEqual } from "node:crypto";
import {
  instagramWebhookPayloadSchema,
  type ParsedInstagramMessage,
} from "./types";

/**
 * Validates Meta HMAC SHA-256 signature from `X-Hub-Signature-256` header.
 * Meta format: `sha256=<hex_digest>`
 */
export function verifyInstagramSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [algo, received] = signatureHeader.split("=");
  if (algo !== "sha256" || !received) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Responds to Meta webhook subscription handshake (GET).
 * Returns the challenge string if token matches, or null if invalid.
 */
export function verifyInstagramChallenge(
  params: URLSearchParams,
  expectedVerifyToken: string,
): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  if (!expectedVerifyToken) return null;
  if (params.get("hub.verify_token") !== expectedVerifyToken) return null;
  return params.get("hub.challenge");
}

/**
 * Parses raw JSON payload into structured Instagram direct messages.
 */
export function parseInstagramWebhook(rawJson: unknown): ParsedInstagramMessage[] {
  const result = instagramWebhookPayloadSchema.safeParse(rawJson);
  if (!result.success) return [];

  const messages: ParsedInstagramMessage[] = [];
  const entries = result.data.entry ?? [];

  for (const entry of entries) {
    const messagingList = entry.messaging ?? [];
    for (const msgEvent of messagingList) {
      if (!msgEvent.message || !msgEvent.sender?.id || !msgEvent.recipient?.id) {
        continue;
      }

      const attachments = (msgEvent.message.attachments ?? []).map((att) => ({
        type: att.type,
        url: att.payload?.url,
      }));

      messages.push({
        messageId: msgEvent.message.mid,
        senderId: msgEvent.sender.id,
        recipientId: msgEvent.recipient.id,
        text: msgEvent.message.text ?? null,
        attachments,
        isEcho: Boolean(msgEvent.message.is_echo),
        timestamp: typeof msgEvent.timestamp === "number" ? msgEvent.timestamp : Date.now(),
      });
    }
  }

  return messages;
}
