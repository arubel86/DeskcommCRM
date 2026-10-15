import { z } from "zod";

/**
 * Esquema de validação para eventos de webhook do Facebook Messenger (Page messaging).
 * Referência: https://developers.facebook.com/docs/messenger-platform/webhooks
 */
export const facebookWebhookPayloadSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        id: z.string(),
        time: z.number().optional(),
        messaging: z
          .array(
            z.object({
              sender: z.object({ id: z.string() }),
              recipient: z.object({ id: z.string() }),
              timestamp: z.number().optional(),
              message: z
                .object({
                  mid: z.string(),
                  text: z.string().optional(),
                  is_echo: z.boolean().optional(),
                  attachments: z
                    .array(
                      z.object({
                        type: z.string(),
                        payload: z
                          .object({
                            url: z.string().optional(),
                          })
                          .optional(),
                      }),
                    )
                    .optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export type FacebookWebhookPayload = z.infer<typeof facebookWebhookPayloadSchema>;

export interface ParsedFacebookMessage {
  messageId: string;
  senderId: string;
  recipientId: string;
  text: string | null;
  attachments: { type: string; url?: string }[];
  isEcho: boolean;
  timestamp: number;
}
