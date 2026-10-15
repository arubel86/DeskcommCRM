import { z } from "zod";

export const emailInboundPayloadSchema = z.object({
  from: z.string().optional(),
  fromAddress: z.string().optional(),
  sender: z.string().optional(),

  fromName: z.string().optional(),
  senderName: z.string().optional(),

  to: z.string().optional(),
  toAddress: z.string().optional(),
  recipient: z.string().optional(),

  subject: z.string().optional(),

  text: z.string().optional(),
  body: z.string().optional(),
  content: z.string().optional(),
  "body-plain": z.string().optional(),

  html: z.string().optional(),
  "body-html": z.string().optional(),

  messageId: z.string().optional(),
  message_id: z.string().optional(),

  attachments: z
    .array(
      z.object({
        type: z.string().optional(),
        url: z.string().optional(),
        filename: z.string().optional(),
      }),
    )
    .optional(),
});

export type EmailInboundPayload = z.infer<typeof emailInboundPayloadSchema>;

export interface ParsedEmailMessage {
  fromEmail: string;
  fromName: string;
  toEmail?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  messageId: string;
  attachments: { type: string; url?: string; filename?: string }[];
  timestamp: number;
}

/**
 * Normaliza qualquer formato de payload de email recebido em uma estrutura padronizada.
 */
export function normalizeEmailPayload(raw: Record<string, unknown>): ParsedEmailMessage | null {
  const parsed = emailInboundPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;

  const data = parsed.data;

  // Extrai email do remetente
  const rawFrom = data.from || data.fromAddress || data.sender || "";
  // Se vier no formato "Nome <email@dominio.com>"
  const emailMatch = rawFrom.match(/<([^>]+)>/);
  const matchedAddress = emailMatch && typeof emailMatch[1] === "string" ? emailMatch[1] : rawFrom;
  const fromEmail = matchedAddress.trim().toLowerCase();

  if (!fromEmail || !fromEmail.includes("@")) {
    return null;
  }

  // Extrai nome do remetente
  let fromName = data.fromName || data.senderName || "";
  if (!fromName && emailMatch) {
    fromName = rawFrom.replace(/<[^>]+>/, "").trim().replace(/^["']|["']$/g, "");
  }
  if (!fromName) {
    const parts = fromEmail.split("@");
    fromName = parts[0] || fromEmail;
  }

  const subject = (data.subject || "Sem assunto").trim();
  const bodyText = (data.text || data.body || data.content || data["body-plain"] || "").trim();
  const bodyHtml = (data.html || data["body-html"] || "").trim() || undefined;

  const messageId =
    data.messageId ||
    data.message_id ||
    `email_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const attachments = (data.attachments || []).map((att) => ({
    type: att.type || "application/octet-stream",
    url: att.url,
    filename: att.filename,
  }));

  return {
    fromEmail,
    fromName,
    toEmail: data.to || data.toAddress || data.recipient,
    subject,
    bodyText,
    bodyHtml,
    messageId,
    attachments,
    timestamp: Date.now(),
  };
}
