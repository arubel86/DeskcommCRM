import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmailPayload } from "@/lib/channels/email-inbound/types";
import { ingestEmailMessage } from "@/lib/channels/email-inbound/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/webhooks/email
 * Healthcheck e validação de ping para serviços de webhook de email.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: "ok",
    channel: "email",
    message: "DeskcommCRM Inbound Email Webhook is active",
  });
}

/**
 * POST /api/v1/webhooks/email
 * Receptor universal de emails entrantes (Zoho Mail, Cloudflare Email Routing, SendGrid, Mailgun, etc.)
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let bodyJson: Record<string, unknown> = {};

  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      bodyJson = (await req.json()) as Record<string, unknown>;
    } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const obj: Record<string, unknown> = {};
      formData.forEach((value, key) => {
        if (typeof value === "string") {
          obj[key] = value;
        }
      });
      bodyJson = obj;
    } else {
      // Fallback tentativa de JSON
      const text = await req.text();
      bodyJson = JSON.parse(text);
    }
  } catch (err) {
    logger.warn("[email.webhook] Falha ao processar corpo da requisição", { err });
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const normalized = normalizeEmailPayload(bodyJson);

  if (!normalized) {
    logger.warn("[email.webhook] Payload de email sem remetente válido (from)", { bodyJson });
    return NextResponse.json(
      { error: "invalid_email_payload", message: "Campo 'from' obrigatório com formato de email válido." },
      { status: 422 },
    );
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
    logger.error("[email.webhook] Nenhuma organização encontrada");
    return NextResponse.json({ error: "organization_not_found" }, { status: 500 });
  }

  try {
    const outcome = await ingestEmailMessage(admin, org.id, normalized);
    return NextResponse.json({
      received: true,
      ...outcome,
    });
  } catch (err) {
    logger.error("[email.webhook] Erro ao ingerir email", { err });
    return NextResponse.json(
      { error: "ingestion_failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
