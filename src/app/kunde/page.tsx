import type { Metadata } from "next";
import { CustomerPortal } from "@/components/customer-portal";

export const metadata: Metadata = { title: "Kundeportal — Nordcall" };

export default function CustomerPage() {
  return <CustomerPortal />;
}
