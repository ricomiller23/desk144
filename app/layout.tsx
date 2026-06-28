import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Desk 144 — restricted-securities sourcing",
  description:
    "Daily SEC Form 144 sweep: ranked OTC block-purchase targets by motivation, stuckness, and size.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
