import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/navigation/AppShell";

export const metadata: Metadata = {
  title: "Ultima Lite",
  description: "Ultima Lite Series 01",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
