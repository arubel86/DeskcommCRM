"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useAgentInbox,
  useResolveAllInboxItems,
  useUpdateInboxItem,
  type AgentInboxItem,
} from "@/hooks/ai/useAgentInbox";
import { kindLabel, SEVERITY_LABEL, type AgentInboxSeverity } from "@/lib/ai/agent-inbox-copy";
import { Bell, Check } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { ApiError } from "@/lib/api/types";

const SEVERITY_VARIANT: Record<AgentInboxSeverity, "info" | "warning" | "error"> = {
  info: "info",
  warn: "warning",
  critical: "error",
};

export function AgentInboxList({ canResolve }: { canResolve: boolean }) {
  const t = useT();
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const { data: cachedData, error, isLoading, isError, refetch, isFetching } = useAgentInbox(tab);
  const acessoNegado = error instanceof ApiError && (error.status === 401 || error.status === 403);
  const data = acessoNegado ? undefined : cachedData;
  const update = useUpdateInboxItem();
  const resolveAll = useResolveAllInboxItems();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "resolved")}>
          <TabsList>
            <TabsTrigger value="open">
              {t("Abertos")}{data ? ` (${data.open_count})` : ""}
            </TabsTrigger>
            <TabsTrigger value="resolved">{t("Resolvidos")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {canResolve && tab === "open" && data && data.items.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={resolveAll.isPending}
            onClick={() => resolveAll.mutate()}
          >
            <Check size={14} aria-hidden />
            {t("Marcar todos resolvidos")}
          </Button>
        ) : null}
      </div>

      {isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4 text-sm">
          <p className="min-w-0 flex-1">{t(acessoNegado ? "Seu acesso aos avisos não está disponível. Confira sua sessão e tente novamente." : data ? "Não foi possível atualizar os avisos. A lista abaixo pode estar desatualizada." : "Não foi possível carregar os avisos. Tente novamente.")}</p>
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>{t("Tentar novamente")}</Button>
        </div>
      ) : null}
      {update.isError ? <p role="alert" className="text-sm text-destructive">{t("Não foi possível atualizar este aviso. Tente novamente.")}</p> : null}
      {/* O lote pode falhar depois de resolver PARTE dos avisos: a mensagem manda
          conferir a lista em vez de afirmar que nada mudou. Sem isto o clique em
          "Marcar todos resolvidos" não deixaria rastro nenhum quando errasse. */}
      {resolveAll.isError ? <p role="alert" className="text-sm text-destructive">{t("Não foi possível resolver todos os avisos. Confira a lista e tente novamente.")}</p> : null}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError && !data ? null : !data || data.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Bell size={28} className="text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">
            {tab === "open" ? t("Nenhum aviso em aberto") : t("Nenhum aviso resolvido")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tab === "open"
              ? t("Quando o assistente precisar de você, o aviso aparece aqui.")
              : t("Avisos que você marcar como resolvidos ficam aqui.")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.items.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              canResolve={canResolve}
              pending={update.isPending}
              onToggle={(status) => update.mutate({ id: item.id, status })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function traduzirAviso(texto: string, t: (s: string) => string): string {
  if (!texto) return texto;
  const traduzido = t(texto);
  if (traduzido !== texto) return traduzido;

  if (texto.startsWith("Compromisso: ") && texto.includes("Abra e registre se a pessoa compareceu")) {
    return texto
      .replace(/^Compromisso:\s*/, "Cita: ")
      .replace("Abra e registre se a pessoa compareceu, faltou ou cancelou. O horário sozinho não confirma falta.", "Abra y registre si la persona asistió, faltó o canceló. El horario por sí solo no confirma la falta.");
  }
  if (texto.startsWith("Decida sobre ") && texto.includes("a sugestão de retomar venceu")) {
    return texto
      .replace("negócio parado", "negocio detenido")
      .replace("negócios parados", "negocios detenidos")
      .replace("a sugestão de retomar venceu", "la sugerencia de retomar venció");
  }
  if (texto.includes("e a sugestão de retomar contato ficou sem resposta até o prazo")) {
    return texto
      .replace("Um negócio esfriou", "Un negocio se enfrió")
      .replace(/(\d+)\s+negócios esfriaram/, "$1 negocios se enfriaron")
      .replace("e a sugestão de retomar contato ficou sem resposta até o prazo. Eles saíram do quadro para não parecerem em andamento. Retomar ou encerrar — as duas são decisões; deixar como está é a única que não é.", "y la sugerencia de retomar contacto quedó sin respuesta hasta el plazo. Salieron del tablero para no parecer en curso. Retomar o cerrar — ambas son decisiones; dejar como está es la única que no lo es.");
  }
  if (texto.startsWith("O agente não conseguiu ler ") && texto.includes("que o cliente enviou")) {
    return texto
      .replace("O agente não conseguiu ler áudio", "El agente no pudo leer el audio")
      .replace("O agente não conseguiu ler foto", "El agente no pudo leer la foto")
      .replace("que o cliente enviou", "que envió el cliente");
  }
  if (texto.startsWith("Motivo: falta uma chave da OpenAI para transcrever")) {
    return "Motivo: falta una clave de OpenAI para transcribir. Mientras tanto, el agente responde avisando que no pudo abrir el archivo. Para resolverlo, ajuste el modelo en este punto en Agente de IA → Proveedores, o registre la clave necesaria en Credenciales.";
  }
  if (texto.startsWith("Número novo aguardando liberação (go-live)")) {
    return texto
      .replace("Número novo aguardando liberação (go-live)", "Número nuevo en espera de habilitación (go-live)")
      .replace("Os disparos que o sistema começa — follow-up e cadência de prospecção — nascem em espera por segurança: a fila retém, nada é perdido. RESPONDER quem te escreveu continua funcionando normalmente. Resolva este item quando o número estiver pronto para disparar.", "Los envíos que inicia el sistema — follow-up y cadencia de prospección — nacen en espera por seguridad: la cola retiene, nada se pierde. RESPONDER a quien te escribió sigue funcionando normalmente. Resuelve este aviso cuando el número esté listo para disparar.");
  }

  return texto;
}

function InboxRow({
  item,
  canResolve,
  pending,
  onToggle,
}: {
  item: AgentInboxItem;
  canResolve: boolean;
  pending: boolean;
  onToggle: (status: "open" | "resolved") => void;
}) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const when = formatDistanceToNowStrict(new Date(item.created_at), {
    addSuffix: true,
    locale: localeDaData,
  });
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid="inbox-item">
      <Badge variant={SEVERITY_VARIANT[item.severity]} className="mt-0.5 shrink-0">
        {t(SEVERITY_LABEL[item.severity])}
      </Badge>
      <div className="min-w-0 flex-1 basis-48 break-words">
        <p className="text-sm font-medium">{traduzirAviso(item.title, t)}</p>
        <p className="text-xs text-muted-foreground">
          {kindLabel(item.kind, t)} · {when}
        </p>
        {item.body ? <p className="mt-1 text-xs text-muted-foreground">{traduzirAviso(item.body, t)}</p> : null}
        {item.destination.orientacao ? <p className="mt-2 text-xs text-muted-foreground">{t(item.destination.orientacao)}</p> : null}
        {item.destination.estado === "disponivel" ? (
          <Button asChild size="sm" variant="link" className="mt-1 h-auto whitespace-normal px-0 text-left">
            <Link href={item.destination.href}>{t(item.destination.rotulo)}</Link>
          </Button>
        ) : null}
      </div>
      {canResolve ? (
        item.status === "resolved" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => onToggle("open")}>
            {t("Reabrir")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onToggle("resolved")}>
            <Check size={14} aria-hidden />
            {t("Marcar resolvido")}
          </Button>
        )
      ) : null}
    </li>
  );
}
