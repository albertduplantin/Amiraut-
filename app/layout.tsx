import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";

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
          <nav className="site-nav">
            <Link href="/" className="brand">
              Les Semaines de l&apos;Hexagone
            </Link>
            <div className="nav-links">
              <Link href="/">Accueil</Link>
              {user && user.role === "ADMIN" && <Link href="/admin">Admin</Link>}
              {user && user.role === "PARTICIPANT" && (
                <Link href="/mon-espace">Mon espace</Link>
              )}
              {user ? (
                <form action={logoutAction}>
                  <button type="submit">Se déconnecter</button>
                </form>
              ) : (
                <>
                  <Link href="/connexion">Connexion</Link>
                  <Link href="/creer-compte">Créer un compte</Link>
                </>
              )}
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          Les Semaines de l&apos;Hexagone
        </footer>
      </body>
    </html>
  );
}
