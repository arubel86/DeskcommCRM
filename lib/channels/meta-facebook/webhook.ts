import { createHmac, timingSafeEqual } from "node:crypto";
import {
  facebookWebhookPayloadSchema,
  type ParsedFacebookMessage,
} from "./types";

/**
 * Valida a assinatura HMAC SHA-256 enviada pela Meta no cabeçalho `X-Hub-Signature-256`.
 * Formato Meta: `sha256=<hex_digest>`
 */
export function verifyFacebookSignature(
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
 * Responde ao handshake de verificação do webhook da Meta (GET).
 * Devolve o valor de `hub.challenge` caso o token confira.
 */
export function verifyFacebookChallenge(
  params: URLSearchParams,
  expectedVerifyToken: string,
): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  if (!expectedVerifyToken) return null;
  if (params.get("hub.verify_token") !== expectedVerifyToken) return null;
  return params.get("hub.challenge");
}

/**
 * Faz o parse do payload cru em mensagens estruturadas do Messenger.
 */
export function parseFacebookWebhook(rawJson: unknown): ParsedFacebookMessage[] {
  const result = facebookWebhookPayloadSchema.safeParse(rawJson);
  if (!result.success) return [];

  const messages: ParsedFacebookMessage[] = [];
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
