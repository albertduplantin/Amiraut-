"use client";

import { useState } from "react";
import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth";

export function SiteNav({ role }: { role: "ADMIN" | "PARTICIPANT" | null }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <nav className="site-nav">
      <div className="nav-top">
        <Link href="/" className="brand" onClick={close}>
          Les Semaines de l&apos;Hexagone
        </Link>
        <button
          type="button"
          className="nav-toggle"
          aria-label="Ouvrir le menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      <div className={`nav-links${open ? " nav-links-open" : ""}`}>
        <Link href="/" onClick={close}>
          Accueil
        </Link>
        {role === "ADMIN" && (
          <Link href="/admin" onClick={close}>
            Admin
          </Link>
        )}
        {role === "PARTICIPANT" && (
          <Link href="/mon-espace" onClick={close}>
            Mon espace
          </Link>
        )}
        {role ? (
          <form action={logoutAction}>
            <button type="submit">Se déconnecter</button>
          </form>
        ) : (
          <>
            <Link href="/connexion" onClick={close}>
              Connexion
            </Link>
            <Link href="/creer-compte" onClick={close}>
              Créer un compte
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
