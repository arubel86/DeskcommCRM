import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import type { ParsedFacebookMessage } from "./types";

export interface IngestFacebookOutcome {
  status: "ingested" | "duplicate" | "ignored" | "failed";
  contactId?: string;
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

/**
 * Resolve ou cria uma sessão de canal para esta Página do Facebook Messenger.
 */
async function getOrCreateFacebookSession(
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
      display_name: "Facebook Messenger",
      metadata: {
        social_platform: "facebook",
        direct_graph_api: true,
      },
    })
    .select("id")
    .single();

  if (error || !created) {
    logger.error("[meta-facebook] Falha ao criar channel_session para Facebook", { error });
    // Fallback: tentar reaproveitar qualquer sessão ativa
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
 * Ingere uma mensagem recebida pelo Facebook Messenger em Contatos, Conversas e Mensagens.
 */
export async function ingestFacebookMessage(
  admin: SupabaseClient,
  organizationId: string,
  msg: ParsedFacebookMessage,
): Promise<IngestFacebookOutcome> {
  // Ignora mensagens enviadas pela própria página (eco)
  if (msg.isEcho) {
    return { status: "ignored", reason: "eco_da_propria_pagina" };
  }

  const sessionId = await getOrCreateFacebookSession(admin, organizationId, msg.recipientId);

  // 1. Resolver o Contato (social_identity canônica)
  const socialIdentity = `facebook:account:${msg.senderId}`;
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
        name: `Facebook (${msg.senderId})`,
      })
      .select("id")
      .single();

    if (errContact || !newContact) {
      logger.error("[meta-facebook] Falha ao criar contato", { error: errContact });
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
        channel: "facebook",
      })
      .eq("id", conversationId);
  } else {
    const { data: newConv, error: errConv } = await admin
      .from("conversations")
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        channel_session_id: sessionId,
        channel: "facebook",
        provider_conversation_id: msg.senderId,
        last_message_at: nowIso,
        last_inbound_at: nowIso,
        last_message_preview: preview,
        status: "open",
      })
      .select("id")
      .single();

    if (errConv || !newConv) {
      logger.error("[meta-facebook] Falha ao criar conversa", { error: errConv });
      return { status: "failed", reason: `conversa: ${errConv?.message}` };
    }
    conversationId = newConv.id;
  }

  if (!contactId || !conversationId) {
    logger.error("[meta-facebook] Falha ao resolver contato ou conversa", { contactId, conversationId });
    return { status: "failed", reason: "falta_contato_ou_conversa" };
  }

  // 3. Inserir a Mensagem (idempotência por external_id)
  const externalId = `facebook:${msg.messageId}`;
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
    if (errInsert.code === "23505") {
      return { status: "duplicate" };
    }
    logger.error("[meta-facebook] Falha ao inserir mensagem", { error: errInsert });
    return { status: "failed", reason: `mensagem: ${errInsert.message}` };
  }

  if (!insertedMsg) {
    return { status: "failed", reason: "mensagem_nao_retornada" };
  }

  const messageId = insertedMsg.id;

  // 4. Efeitos pós-entrada (SDR IA Agent, Webhooks, Kanban)
  try {
    await aplicarEfeitosPosEntrada(admin, {
      organizationId,
      contactId,
      conversationId,
      messageId,
      channelSessionId: sessionId,
      texto: msg.text,
      nomeDoContato: `Facebook (${msg.senderId})`,
      origem: "meta_facebook",
    });
  } catch (err) {
    logger.error("[meta-facebook] Erro não-bloqueante nos efeitos pós-entrada", { err });
  }

  return {
    status: "ingested",
    contactId,
    conversationId,
    messageId,
  };
}
