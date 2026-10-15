import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyFacebookChallenge,
  verifyFacebookSignature,
  parseFacebookWebhook,
} from "@/lib/channels/meta-facebook/webhook";
import { ingestFacebookMessage } from "@/lib/channels/meta-facebook/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/webhooks/facebook
 * Meta webhook verification handshake for Facebook Page / Messenger.
 * Meta envia hub.mode, hub.verify_token e hub.challenge.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const verifyToken =
    process.env.META_FACEBOOK_VERIFY_TOKEN ||
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    process.env.META_INSTAGRAM_VERIFY_TOKEN ||
    "aizprua_facebook_verify_token_2026";

  const challenge = verifyFacebookChallenge(params, verifyToken);

  if (challenge === null) {
    logger.warn("[facebook.webhook] Falha no handshake: verify_token inválido", {
      received: params.get("hub.verify_token"),
    });
    return new NextResponse("forbidden", { status: 403 });
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * POST /api/v1/webhooks/facebook
 * Receptor de mensagens em tempo real do Facebook Messenger.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const appSecret =
    process.env.META_FACEBOOK_APP_SECRET ||
    process.env.META_APP_SECRET ||
    "";

  // Se o App Secret estiver configurado, valida a assinatura HMAC
  if (appSecret && !verifyFacebookSignature(rawBody, signature, appSecret)) {
    logger.warn("[facebook.webhook] Assinatura inválida no webhook de Facebook");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const messages = parseFacebookWebhook(json);
  if (messages.length === 0) {
    return NextResponse.json({ status: "ignored", reason: "sem_mensagens_de_entrada" });
  }

  const admin = createAdminClient();

  // Resolve a organização padrão
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (!org?.id) {
    logger.error("[facebook.webhook] Nenhuma organização encontrada no CRM");
    return NextResponse.json({ error: "organization_not_found" }, { status: 500 });
  }

  const results = [];
  for (const msg of messages) {
    try {
      const outcome = await ingestFacebookMessage(admin, org.id, msg);
      results.push(outcome);
    } catch (err) {
      logger.error("[facebook.webhook] Erro ao ingerir mensagem", { err });
      results.push({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    received: true,
    processed: results.length,
    results,
  });
}
