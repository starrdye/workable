import type { Metadata } from "next";
import { HermesView } from "@/components/hermes/HermesView";

export const metadata: Metadata = {
  title: "Workable — Hermes team",
  description: "Live, read-only map of your local Hermes agent team.",
};

export default function HermesPage() {
  return <HermesView />;
}
