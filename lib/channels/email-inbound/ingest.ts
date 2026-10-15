import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import type { ParsedEmailMessage } from "./types";

export interface IngestEmailOutcome {
  status: "ingested" | "duplicate" | "ignored" | "failed";
  contactId?: string;
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

/**
 * Resolve ou cria uma sessão de canal para Correo (Email).
 */
async function getOrCreateEmailSession(
  admin: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider", "email")
    .is("archived_at", null)
    .maybeSingle();

  if (existing?.id) return existing.id;

  // Criptografa um segredo padrão para atender à restrição NOT NULL
  const secretEncrypted = await encryptWebhookSecret(admin, "email_webhook_secret_internal");

  const { data: created, error } = await admin
    .from("channel_sessions")
    .insert({
      organization_id: organizationId,
      provider: "email",
      status: "WORKING",
      display_name: "Correo Electrónico",
      webhook_secret_encrypted: secretEncrypted ?? "encrypted_email_channel_placeholder",
      metadata: {
        email_channel: true,
      },
    })
    .select("id")
    .single();

  if (error || !created) {
    logger.error("[email-inbound] Falha ao criar channel_session para Email", { error });
    // Fallback: reutilizar qualquer sessão ativa
    const { data: fallback } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    if (fallback?.id) return fallback.id;
    throw new Error(`Nao foi possivel resolver channel_session de email: ${error?.message}`);
  }

  return created.id;
}

/**
 * Ingere uma mensagem de email recebida em Contatos, Conversas e Mensagens.
 */
export async function ingestEmailMessage(
  admin: SupabaseClient,
  organizationId: string,
  msg: ParsedEmailMessage,
): Promise<IngestEmailOutcome> {
  const sessionId = await getOrCreateEmailSession(admin, organizationId);

  // 1. Resolver o Contato pelo Email
  const socialIdentity = `email:account:${msg.fromEmail}`;
  let contactId: string | null = null;

  // Busca por email ou por social_identity
  const { data: existingContact } = await admin
    .from("contacts")
    .select("id, name, email")
    .eq("organization_id", organizationId)
    .or(`email.eq.${msg.fromEmail},social_identity.eq.${socialIdentity}`)
    .maybeSingle();

  if (existingContact?.id) {
    contactId = existingContact.id;
    // Se o contato existente não tinha nome, atualiza
    if (!existingContact.name && msg.fromName) {
      await admin
        .from("contacts")
        .update({ name: msg.fromName })
        .eq("id", contactId);
    }
  } else {
    const { data: newContact, error: errContact } = await admin
      .from("contacts")
      .insert({
        organization_id: organizationId,
        email: msg.fromEmail,
        name: msg.fromName,
        social_identity: socialIdentity,
      })
      .select("id")
      .single();

    if (errContact || !newContact) {
      logger.error("[email-inbound] Falha ao criar contato", { error: errContact });
      return { status: "failed", reason: `contato: ${errContact?.message}` };
    }
    contactId = newContact.id;
  }

  // 2. Resolver a Conversa do Canal Email
  let conversationId: string | null = null;
  const { data: existingConv } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("channel", "email")
    .maybeSingle();

  const preview = (msg.subject ? `[${msg.subject}] ` : "") + (msg.bodyText || "[Sem texto]").slice(0, 100);
  const nowIso = new Date(msg.timestamp).toISOString();

  if (existingConv?.id) {
    conversationId = existingConv.id;
    await admin
      .from("conversations")
      .update({
        last_message_at: nowIso,
        last_inbound_at: nowIso,
        last_message_preview: preview.slice(0, 120),
        status: "open",
      })
      .eq("id", conversationId);
  } else {
    const { data: newConv, error: errConv } = await admin
      .from("conversations")
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        channel_session_id: sessionId,
        channel: "email",
        provider_conversation_id: msg.fromEmail,
        last_message_at: nowIso,
        last_inbound_at: nowIso,
        last_message_preview: preview.slice(0, 120),
        status: "open",
      })
      .select("id")
      .single();

    if (errConv || !newConv) {
      logger.error("[email-inbound] Falha ao criar conversa", { error: errConv });
      return { status: "failed", reason: `conversa: ${errConv?.message}` };
    }
    conversationId = newConv.id;
  }

  if (!contactId || !conversationId) {
    return { status: "failed", reason: "falta_contato_ou_conversa" };
  }

  // 3. Inserir a Mensagem (idempotência por external_id)
  const externalId = `email:${msg.messageId}`;
  const fullBody = msg.subject
    ? `**Asunto:** ${msg.subject}\n\n${msg.bodyText}`
    : msg.bodyText;

  const { data: insertedMsg, error: errInsert } = await admin
    .from("messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      contact_id: contactId,
      channel_session_id: sessionId,
      external_id: externalId,
      direction: "inbound",
      type: "text",
      status: "delivered",
      body: fullBody,
      sent_at: nowIso,
    })
    .select("id")
    .single();

  if (errInsert) {
    if (errInsert.code === "23505") {
      return { status: "duplicate" };
    }
    logger.error("[email-inbound] Falha ao inserir mensagem", { error: errInsert });
    return { status: "failed", reason: `mensagem: ${errInsert.message}` };
  }

  if (!insertedMsg) {
    return { status: "failed", reason: "mensagem_nao_retornada" };
  }

  const messageId = insertedMsg.id;

  // 4. Efeitos pós-entrada (SDR IA Agent, Notificações, Kanban)
  try {
    await aplicarEfeitosPosEntrada(admin, {
      organizationId,
      contactId,
      conversationId,
      messageId,
      channelSessionId: sessionId,
      texto: msg.bodyText,
      nomeDoContato: msg.fromName,
      origem: "email",
    });
  } catch (err) {
    logger.error("[email-inbound] Erro não-bloqueante nos efeitos pós-entrada", { err });
  }

  return {
    status: "ingested",
    contactId,
    conversationId,
    messageId,
  };
}
