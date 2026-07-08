import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RDT Lab",
  description: "Visual UDP reliable data transfer lab"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
