import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyInstagramChallenge,
  verifyInstagramSignature,
  parseInstagramWebhook,
} from "@/lib/channels/meta-instagram/webhook";
import { ingestInstagramMessage } from "@/lib/channels/meta-instagram/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/webhooks/instagram
 * Meta webhook verification handshake.
 * Meta sends hub.mode, hub.verify_token, and hub.challenge.
 * We must return hub.challenge as plain text HTTP 200.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const verifyToken =
    process.env.META_INSTAGRAM_VERIFY_TOKEN ||
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    "aizprua_instagram_token";

  const challenge = verifyInstagramChallenge(params, verifyToken);

  if (challenge === null) {
    logger.warn("[instagram.webhook] Falha no handshake: verify_token inválido", {
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
 * POST /api/v1/webhooks/instagram
 * Real-time event receiver for Instagram Direct messages.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const appSecret =
    process.env.META_INSTAGRAM_APP_SECRET ||
    process.env.META_APP_SECRET ||
    "";

  // Se o App Secret estiver configurado, validamos a assinatura HMAC estrita
  if (appSecret && !verifyInstagramSignature(rawBody, signature, appSecret)) {
    logger.warn("[instagram.webhook] Assinatura inválida no webhook de Instagram");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const messages = parseInstagramWebhook(json);
  if (messages.length === 0) {
    // Retorna 200 para eventos não-relevantes (mudança de status, eco, etc.)
    return NextResponse.json({ status: "ignored", reason: "sem_mensagens_de_entrada" });
  }

  const admin = createAdminClient();

  // Resolve a organização padrão (Aizprua)
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (!org?.id) {
    logger.error("[instagram.webhook] Nenhuma organização encontrada no CRM");
    return NextResponse.json({ error: "organization_not_found" }, { status: 500 });
  }

  const results = [];
  for (const msg of messages) {
    try {
      const outcome = await ingestInstagramMessage(admin, org.id, msg);
      results.push(outcome);
    } catch (err) {
      logger.error("[instagram.webhook] Erro ao ingerir mensagem", { err });
      results.push({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    received: true,
    processed: results.length,
    results,
  });
}
