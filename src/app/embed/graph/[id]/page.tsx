import type { Metadata } from "next";
import { WorkflowCard } from "@/components/WorkflowCard";

export const metadata: Metadata = { title: "Workable — workflow" };

/** Compact workflow card, framed by the Hermes chat (::workable-graph{id="…"}). */
export default async function EmbedGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkflowCard id={id} />;
}
