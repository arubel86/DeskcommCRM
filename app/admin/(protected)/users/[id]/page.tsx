import { UserDetailClient } from "./_client";

export const metadata = { title: "Detalle de usuario — Admin Plataforma" };

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <UserDetailClient id={id} />;
}
