import type { Metadata } from "next";
import "./globals.css";
import "./workflows.css";
import "./clinical.css";
import "./adt.css";

export const metadata: Metadata = {
  title: "Hospital ONE",
  description: "Hospital operations, clinical care, and revenue in one secure workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
