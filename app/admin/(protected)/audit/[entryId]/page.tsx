import { AuditDetailClient } from "./_client";

interface AuditDetailPageProps {
  params: Promise<{ entryId: string }>;
}

export const metadata = {
  title: "Entrada de auditoría — Admin",
};

export default async function AuditDetailPage({ params }: AuditDetailPageProps) {
  const { entryId } = await params;
  return <AuditDetailClient entryId={entryId} />;
}
