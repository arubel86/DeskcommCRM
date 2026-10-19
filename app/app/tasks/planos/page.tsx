import type { Metadata } from "next";

import { PlanosDeTarefa } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Planes de tareas" };

export default function PaginaDePlanosDeTarefa() {
  return <PlanosDeTarefa />;
}
