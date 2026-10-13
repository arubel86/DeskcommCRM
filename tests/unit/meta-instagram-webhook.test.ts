import { describe, expect, it } from "vitest";
import {
  verifyInstagramChallenge,
  verifyInstagramSignature,
  parseInstagramWebhook,
} from "@/lib/channels/meta-instagram/webhook";
import { createHmac } from "node:crypto";

describe("Meta Instagram Webhook Connector", () => {
  it("responde corretamente ao handshake hub.challenge", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "token_secreto_teste",
      "hub.challenge": "desafio_12345",
    });

    const valido = verifyInstagramChallenge(params, "token_secreto_teste");
    expect(valido).toBe("desafio_12345");

    const tokenErrado = verifyInstagramChallenge(params, "outro_token");
    expect(tokenErrado).toBeNull();
  });

  it("valida a assinatura HMAC SHA-256 de Meta", () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const secret = "app_secret_123";
    const hmac = createHmac("sha256", secret).update(body).digest("hex");
    const header = `sha256=${hmac}`;

    expect(verifyInstagramSignature(body, header, secret)).toBe(true);
    expect(verifyInstagramSignature(body, "sha256=invalido", secret)).toBe(false);
    expect(verifyInstagramSignature(body, header, "outro_secret")).toBe(false);
  });

  it("parseia mensagens de entrada do Instagram Direct corretamente", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "17841400000000",
          time: 1728800000,
          messaging: [
            {
              sender: { id: "user_ig_999" },
              recipient: { id: "17841400000000" },
              timestamp: 1728800000123,
              message: {
                mid: "mid.instagram.12345",
                text: "Hola, me interesa el servicio",
              },
            },
          ],
        },
      ],
    };

    const parsed = parseInstagramWebhook(payload);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].senderId).toBe("user_ig_999");
    expect(parsed[0].recipientId).toBe("17841400000000");
    expect(parsed[0].messageId).toBe("mid.instagram.12345");
    expect(parsed[0].text).toBe("Hola, me interesa el servicio");
    expect(parsed[0].isEcho).toBe(false);
  });

  it("ignora eventos vazios ou sem mensagem", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "17841400000000",
          messaging: [],
        },
      ],
    };

    const parsed = parseInstagramWebhook(payload);
    expect(parsed).toEqual([]);
  });
});
