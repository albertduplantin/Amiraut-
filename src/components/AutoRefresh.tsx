"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Rafraîchit silencieusement la page (données serveur) à intervalle
 * régulier — pour un écran purement passif (rien à cliquer, rien à perdre
 * en re-rendant), là où l'utilisateur attend qu'un événement côté serveur
 * change l'affichage sans action de sa part.
 *
 * Ne PAS poser sur un écran avec un brouillon en cours (dessin de trajet,
 * saisie) : `router.refresh()` reprend les props serveur, un rafraîchissement
 * pourrait effacer une saisie non validée. Voir TacticalView.tsx pour un
 * exemple de la même idée posée volontairement sur un écran avec brouillons
 * (acceptable là car les brouillons y survivent au refresh, cf. son propre
 * state local).
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
