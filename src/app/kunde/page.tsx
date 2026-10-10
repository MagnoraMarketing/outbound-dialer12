import type { Metadata, Viewport } from "next";
import { CustomerPortal } from "@/components/customer-portal";

export const metadata: Metadata = {
  title: "Kundeportal — Nordcall",
  description: "Se de møder, vi har booket for dig, og giv status efter hvert møde.",
  manifest: "/kunde/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Kundeportal", statusBarStyle: "default" },
  icons: { icon: "/app-icon/192.png", apple: "/app-icon/180.png" },
};

export const viewport: Viewport = { themeColor: "#3249ce" };

export default function CustomerPage() {
  return <CustomerPortal />;
}
