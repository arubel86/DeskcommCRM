import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import type { ParsedInstagramMessage } from "./types";

export interface IngestInstagramOutcome {
  status: "ingested" | "duplicate" | "ignored" | "failed";
  contactId?: string;
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

/**
 * Resolves or creates a channel session for this Instagram Business account.
 */
async function getOrCreateInstagramSession(
  admin: SupabaseClient,
  organizationId: string,
  recipientId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("zernio_account_id", recipientId)
    .is("archived_at", null)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await admin
    .from("channel_sessions")
    .insert({
      organization_id: organizationId,
      provider: "zernio_social",
      zernio_account_id: recipientId,
      status: "WORKING",
      display_name: "Instagram Direct",
      metadata: {
        social_platform: "instagram",
        direct_graph_api: true,
      },
    })
    .select("id")
    .single();

  if (error || !created) {
    logger.error("[meta-instagram] Falha ao criar channel_session para Instagram", { error });
    // Fallback: try to find any active session for the org
    const { data: fallback } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    if (fallback?.id) return fallback.id;
    throw new Error(`Nao foi possivel resolver channel_session: ${error?.message}`);
  }

  return created.id;
}

/**
 * Ingests an incoming Instagram Direct message into Contacts, Conversations, and Messages.
 */
export async function ingestInstagramMessage(
  admin: SupabaseClient,
  organizationId: string,
  msg: ParsedInstagramMessage,
): Promise<IngestInstagramOutcome> {
  // Ignora mensagens enviadas pela própria página (eco)
  if (msg.isEcho) {
    return { status: "ignored", reason: "eco_da_propria_pagina" };
  }

  const sessionId = await getOrCreateInstagramSession(admin, organizationId, msg.recipientId);

  // 1. Resolver o Contato (social_identity canônica)
  const socialIdentity = `instagram:account:${msg.senderId}`;
  let contactId: string | null = null;

  const { data: existingContact } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("social_identity", socialIdentity)
    .maybeSingle();

  if (existingContact?.id) {
    contactId = existingContact.id;
  } else {
    const { data: newContact, error: errContact } = await admin
      .from("contacts")
      .insert({
        organization_id: organizationId,
        social_identity: socialIdentity,
        name: `Instagram (${msg.senderId})`,
      })
      .select("id")
      .single();

    if (errContact || !newContact) {
      logger.error("[meta-instagram] Falha ao criar contato", { error: errContact });
      return { status: "failed", reason: `contato: ${errContact?.message}` };
    }
    contactId = newContact.id;
  }

  // 2. Resolver a Conversa
  let conversationId: string | null = null;
  const { data: existingConv } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider_conversation_id", msg.senderId)
    .maybeSingle();

  const preview = (msg.text ?? (msg.attachments.length > 0 ? "[mídia]" : "")).slice(0, 120);
  const nowIso = new Date(msg.timestamp).toISOString();

  if (existingConv?.id) {
    conversationId = existingConv.id;
    await admin
      .from("conversations")
      .update({
        last_message_at: nowIso,
        last_inbound_at: nowIso,
        last_message_preview: preview,
        channel: "instagram",
      })
      .eq("id", conversationId);
  } else {
    const { data: newConv, error: errConv } = await admin
      .from("conversations")
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        channel_session_id: sessionId,
        channel: "instagram",
        provider_conversation_id: msg.senderId,
        last_message_at: nowIso,
        last_inbound_at: nowIso,
        last_message_preview: preview,
        status: "open",
      })
      .select("id")
      .single();

    if (errConv || !newConv) {
      logger.error("[meta-instagram] Falha ao criar conversa", { error: errConv });
      return { status: "failed", reason: `conversa: ${errConv?.message}` };
    }
    conversationId = newConv.id;
  }

  if (!contactId || !conversationId) {
    logger.error("[meta-instagram] Falha ao resolver contato ou conversa", { contactId, conversationId });
    return { status: "failed", reason: "falta_contato_ou_conversa" };
  }

  // 3. Inserir a Mensagem (idempotência por external_id)
  const externalId = `instagram:${msg.messageId}`;
  const firstAttachment = msg.attachments[0];

  const { data: insertedMsg, error: errInsert } = await admin
    .from("messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      contact_id: contactId,
      channel_session_id: sessionId,
      external_id: externalId,
      direction: "inbound",
      type: firstAttachment ? "image" : "text",
      status: "delivered",
      body: msg.text ?? "",
      media_url: firstAttachment?.url ?? null,
      sent_at: nowIso,
    })
    .select("id")
    .single();

  if (errInsert) {
    // Código 23505 = violação de unicidade (já foi ingerida antes)
    if (errInsert.code === "23505") {
      return { status: "duplicate" };
    }
    logger.error("[meta-instagram] Falha ao inserir mensagem", { error: errInsert });
    return { status: "failed", reason: `mensagem: ${errInsert.message}` };
  }

  if (!insertedMsg) {
    return { status: "failed", reason: "mensagem_nao_retornada" };
  }

  const messageId = insertedMsg.id;

  // 4. Efeitos pós-entrada (SDR IA Agent, Webhooks, Lead no Kanban)
  try {
    await aplicarEfeitosPosEntrada(admin, {
      organizationId,
      contactId,
      conversationId,
      messageId,
      channelSessionId: sessionId,
      texto: msg.text,
      nomeDoContato: `Instagram (${msg.senderId})`,
      origem: "meta_instagram",
    });
  } catch (err) {
    logger.error("[meta-instagram] Erro não-bloqueante nos efeitos pós-entrada", { err });
  }

  return {
    status: "ingested",
    contactId,
    conversationId,
    messageId,
  };
}
