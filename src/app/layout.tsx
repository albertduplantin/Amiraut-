import type { Metadata } from "next";
import { Geist, Geist_Mono, Special_Elite } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Police dactylo évoquant les dépêches et registres de bord des années 40,
// réservée aux titres/en-têtes (voir .font-display dans globals.css).
const specialElite = Special_Elite({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Amirauté en ligne",
  description: "Wargame naval asynchrone — Convoi JW55B/RA55A, décembre 1943",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} ${specialElite.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
