import { IncidentDetailClient } from "./_client";

export const metadata = { title: "Detalle del incidente — Admin Plataforma" };

export default async function AdminIncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IncidentDetailClient id={id} />;
}
