import type { Metadata } from "next";
import "./globals.css";
import "./workflows.css";
import "./clinical.css";
import "./adt.css";
import "./navigation.css";
import "./encounter-details.css";
import{RootShell}from"@/components/root-shell";

export const metadata: Metadata = {
  title: "Hospital ONE",
  description: "Hospital operations, clinical care, and revenue in one secure workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full"><RootShell>{children}</RootShell></body>
    </html>
  );
}
