import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { SiteNav } from "@/components/site-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Les Semaines de l'Hexagone",
  description: "Séjours de jeux de société",
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
        <header className="site-header">
          <SiteNav role={user?.role ?? null} />
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          Les Semaines de l&apos;Hexagone
        </footer>
      </body>
    </html>
  );
}
