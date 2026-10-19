/**
 * Convite de time, em PT-BR, sem React Email. Devolve subject/html/text.
 * Estilo inline apenas (compatibilidade com cliente de e-mail); zero asset
 * externo.
 *
 * É o PRIMEIRO artefato que um usuário novo recebe do sistema — e chegava com
 * o nome do NOSSO produto em vez do da instalação que convidou. A marca entra
 * resolvida (`marcaDaSaida(organizationId)`, classe A: há organização), e as
 * cores deixam de ser hexes inventados aqui: o botão usa o accent derivado e o
 * resto vem dos neutros da régua do produto.
 *
 * O LOGO entrou depois, e por um motivo medido: `MarcaDeSaida.logoUrl` era
 * campo morto — resolvido, entregue a este template e a nenhum outro, e
 * renderizado por ninguém. Um e-mail que diz o nome do revendedor mas mostra a
 * arte de ninguém é meia marca; e este é o e-mail que a pessoa abre antes de
 * ter visto qualquer tela do produto.
 */
import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";

export interface InviteEmailOptions {
  inviterName: string;
  orgName: string;
  acceptUrl: string;
  role: string;
  expiresAt: Date;
  /** A marca de quem convidou. Obrigatória — sem ela o e-mail não tem dono. */
  marca: MarcaDeSaida;
  idioma?: string;
  timeZone?: string;
}

const PAPEIS_TRADUCAO: Record<string, Record<string, string>> = {
  es: {
    admin: "administrador",
    manager: "gerente",
    agent: "agente",
    viewer: "visualizador",
  },
  "pt-BR": {
    admin: "administrador",
    manager: "gerente",
    agent: "agente",
    viewer: "visualizador",
  },
  en: {
    admin: "admin",
    manager: "manager",
    agent: "agent",
    viewer: "viewer",
  },
};

export function buildInviteEmail(opts: InviteEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const idioma = opts.idioma ?? "es";
  const tz = opts.timeZone ?? (idioma === "pt-BR" ? "America/Sao_Paulo" : "America/Panama");
  const locale = idioma === "pt-BR" ? "pt-BR" : idioma === "en" ? "en-US" : "es";

  const expiresStr = opts.expiresAt.toLocaleString(locale, {
    timeZone: tz,
  });
  const marca = opts.marca.nome;
  const papel = PAPEIS_TRADUCAO[idioma]?.[opts.role] ?? opts.role;

  let subject: string;
  let titulo: string;
  let corpo: string;
  let botao: string;
  let copiarLink: string;
  let expiraEm: string;
  let textoPlano: string[];

  const mesmoNome = opts.orgName.trim().toLowerCase() === marca.trim().toLowerCase();

  if (idioma === "pt-BR") {
    subject = mesmoNome
      ? `${opts.inviterName} convidou você para a ${opts.orgName}`
      : `${opts.inviterName} convidou você para a ${opts.orgName} no ${marca}`;
    titulo = `Você foi convidado para a ${escapeHtml(opts.orgName)}`;
    corpo = `${escapeHtml(opts.inviterName)} convidou você como <strong>${escapeHtml(papel)}</strong> no ${escapeHtml(marca)}.`;
    botao = "Aceitar convite";
    copiarLink = "Ou copie e cole este link no navegador:";
    expiraEm = `Este link expira em <strong>${expiresStr}</strong>. Se você não esperava este convite, pode ignorá-lo.`;
    textoPlano = [
      `Você foi convidado para a ${opts.orgName} como ${papel} no ${marca}.`,
      "",
      `Aceitar: ${opts.acceptUrl}`,
      "",
      `Expira em ${expiresStr}.`,
    ];
  } else if (idioma === "en") {
    subject = mesmoNome
      ? `${opts.inviterName} invited you to ${opts.orgName}`
      : `${opts.inviterName} invited you to ${opts.orgName} on ${marca}`;
    titulo = `You have been invited to ${escapeHtml(opts.orgName)}`;
    corpo = `${escapeHtml(opts.inviterName)} invited you as <strong>${escapeHtml(papel)}</strong> on ${escapeHtml(marca)}.`;
    botao = "Accept invite";
    copiarLink = "Or copy and paste this link into your browser:";
    expiraEm = `This link expires on <strong>${expiresStr}</strong>. If you were not expecting this invite, you can ignore it.`;
    textoPlano = [
      `You have been invited to ${opts.orgName} as ${papel} on ${marca}.`,
      "",
      `Accept: ${opts.acceptUrl}`,
      "",
      `Expires on ${expiresStr}.`,
    ];
  } else {
    // Español (default)
    subject = mesmoNome
      ? `${opts.inviterName} te ha invitado a ${opts.orgName}`
      : `${opts.inviterName} te ha invitado a ${opts.orgName} en ${marca}`;
    titulo = `Has sido invitado a ${escapeHtml(opts.orgName)}`;
    corpo = `${escapeHtml(opts.inviterName)} te invitó como <strong>${escapeHtml(papel)}</strong> en ${escapeHtml(marca)}.`;
    botao = "Aceptar invitación";
    copiarLink = "O copia y pega este enlace en el navegador:";
    expiraEm = `Este enlace expira el <strong>${expiresStr}</strong>. Si no esperabas esta invitación, puedes ignorarla.`;
    textoPlano = [
      `Has sido invitado a ${opts.orgName} como ${papel} en ${marca}.`,
      "",
      `Aceptar invitación: ${opts.acceptUrl}`,
      "",
      `Expira el ${expiresStr}.`,
    ];
  }

  /**
   * O logo de quem convidou, quando há um.
   *
   * `<img>` solto e não background: cliente de e-mail não carrega CSS externo e
   * boa parte ignora `background-image`. Dimensão no ATRIBUTO além do style
   * porque Outlook desktop descarta `height` de style em imagem, e sem dimensão
   * ele renderiza a arte no tamanho original — um PNG de 1200px arrebentaria a
   * largura de 560 do corpo.
   *
   * A URL passa por `escapeHtml` como qualquer outro valor: ela vem de
   * `platform_branding.logo_url`, que é `text` livre no banco (a tela de marca
   * ainda não a edita), e uma aspa ali escaparia do atributo.
   *
   * Sem logo, NADA é renderizado: um espaço reservado vazio é pior que ausência
   * — o cliente de e-mail desenharia o ícone de imagem quebrada no topo do
   * primeiro e-mail que a pessoa recebe do sistema.
   */
  const logo = opts.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapeHtml(opts.marca.logoUrl)}" alt="${escapeHtml(marca)}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";

  const html = `<!doctype html>
<html lang="${idioma}">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${logo}
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">
      ${titulo}
    </h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
      ${corpo}
    </p>
    <p style="margin:24px 0">
      <a href="${opts.acceptUrl}" style="display:inline-block;padding:12px 24px;background:${opts.marca.accent};color:${opts.marca.accentFg};border-radius:6px;text-decoration:none;font-weight:600">
        ${botao}
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">
      ${copiarLink}<br>
      <span style="word-break:break-all;color:${opts.marca.accent}">${opts.acceptUrl}</span>
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">
      ${expiraEm}
    </p>
  </div>
</body>
</html>`;

  const text = textoPlano.join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
