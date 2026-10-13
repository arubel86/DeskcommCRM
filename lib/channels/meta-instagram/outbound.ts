import { graphVersion } from "@/lib/graph-version";
import { logger } from "@/lib/logger";

export interface SendInstagramMessageParams {
  recipientId: string;
  text?: string | null;
  mediaUrl?: string | null;
  mediaType?: "image" | "audio" | "video" | "file";
  pageAccessToken: string;
}

export interface SendInstagramMessageResult {
  messageId: string;
  recipientId: string;
}

/**
 * Sends a Direct Message to an Instagram user via Meta Graph API.
 */
export async function sendInstagramMessage(
  params: SendInstagramMessageParams,
): Promise<SendInstagramMessageResult> {
  const version = graphVersion ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/me/messages`;

  const payload: Record<string, unknown> = {
    recipient: { id: params.recipientId },
  };

  if (params.mediaUrl) {
    const attachmentType = params.mediaType ?? "image";
    payload.message = {
      attachment: {
        type: attachmentType,
        payload: {
          url: params.mediaUrl,
          is_reusable: true,
        },
      },
    };
  } else if (params.text) {
    payload.message = {
      text: params.text,
    };
  } else {
    throw new Error("sendInstagramMessage: text or mediaUrl is required");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.pageAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await response.json();

  if (!response.ok) {
    logger.error("[meta-instagram.outbound] Falha ao enviar DM", {
      status: response.status,
      error: body?.error,
    });
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Falha ao enviar mensagem no Instagram: ${message}`);
  }

  return {
    messageId: body.message_id,
    recipientId: body.recipient_id,
  };
}
