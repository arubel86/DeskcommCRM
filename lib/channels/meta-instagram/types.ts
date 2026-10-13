import { z } from "zod";

/**
 * Zod schema for Instagram Direct Webhook payloads sent by Meta Graph API.
 * Meta payload specification:
 * https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook
 */

const text = z.string().nullish();

export const instagramAttachmentSchema = z.looseObject({
  type: z.string(),
  payload: z.looseObject({
    url: z.string().optional(),
  }),
});

export const instagramMessageDataSchema = z.looseObject({
  mid: z.string(),
  text: text,
  attachments: z.array(instagramAttachmentSchema).nullish(),
  is_echo: z.boolean().optional(),
});

export const instagramMessagingEventSchema = z.looseObject({
  sender: z.looseObject({ id: z.string() }),
  recipient: z.looseObject({ id: z.string() }),
  timestamp: z.number().or(z.string()).optional(),
  message: instagramMessageDataSchema.nullish(),
});

export const instagramEntrySchema = z.looseObject({
  id: text,
  time: z.number().optional(),
  messaging: z.array(instagramMessagingEventSchema).nullish(),
});

export const instagramWebhookPayloadSchema = z.looseObject({
  object: text,
  entry: z.array(instagramEntrySchema).nullish(),
});

export type InstagramWebhookPayload = z.infer<typeof instagramWebhookPayloadSchema>;

export interface ParsedInstagramMessage {
  messageId: string;
  senderId: string;
  recipientId: string;
  text: string | null;
  attachments: Array<{ type: string; url?: string }>;
  isEcho: boolean;
  timestamp: number;
}
