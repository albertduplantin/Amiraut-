import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { SiteNav } from "@/components/site-nav";
import { RegisterServiceWorker } from "@/components/register-sw";
import { getBaseUrl } from "@/lib/url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: "Les Semaines de l'Hexagone",
  description: "Séjours de jeux de société — Cercle de Stratégie",
  openGraph: {
    title: "Les Semaines de l'Hexagone",
    description: "Séjours de jeux de société — Cercle de Stratégie",
    type: "website",
    locale: "fr_FR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Les Semaines de l'Hexagone",
    description: "Séjours de jeux de société — Cercle de Stratégie",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d4645",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <a href="#contenu" className="skip-link">
          Aller au contenu
        </a>
        <header className="site-header">
          <SiteNav role={user?.role ?? null} />
        </header>
        <main id="contenu">{children}</main>
        <footer className="site-footer">
          <p>Les Semaines de l&apos;Hexagone — Cercle de Stratégie</p>
          <p className="btn-row" style={{ justifyContent: "center", marginTop: 8 }}>
            <Link href="/mentions-legales">Mentions légales</Link>
            <Link href="/confidentialite">Confidentialité</Link>
            <Link href="/cgv">CGV</Link>
          </p>
        </footer>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
