"use client";

import { useEffect } from "react";

/** Bruit d'explosion joué à l'apparition de la fenêtre. */
const EXPLOSION_SOUND_URL = "/sounds/explosion.wav";

export type SunkShipInfo = {
  id: string;
  name: string;
  className: string;
  profileImageUrl: string | null;
  /** Vrai si c'est notre propre navire qui coule (nouvelle perdue), faux si c'est une prise ennemie. */
  own: boolean;
};

/**
 * Fenêtre surgissante au moment où un navire coule — silhouette, bulles et
 * fumée animées en CSS (aucun asset externe, ni photo ni vidéo : voir la
 * discussion avec l'utilisateur sur le sujet, qui a préféré cette option).
 * Se ferme seule après quelques secondes, ou au clic.
 */
export function SunkShipModal({ ship, onClose }: { ship: SunkShipInfo; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  // Un son par navire affiché (pas par montage du composant, qui reste
  // monté d'un navire à l'autre quand la file s'enchaîne) — voir la clé
  // [ship.id] : autoplay refusé par le navigateur = son manquant, non
  // bloquant, comme pour les bruits de canon/torpille.
  useEffect(() => {
    const audio = new Audio(EXPLOSION_SOUND_URL);
    audio.volume = 0.7;
    audio.play().catch(() => {});
  }, [ship.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${ship.own ? "Navire perdu" : "Navire coulé"} : ${ship.name}`}
    >
      <div
        className="relative mx-4 w-full max-w-sm rounded-lg border border-slate-700 bg-slate-950 p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={`font-display text-2xl tracking-wide ${ship.own ? "text-red-400" : "text-brass-300"}`}>
          {ship.own ? "Navire perdu" : "Coulé !"}
        </h2>
        <p className="mt-1 text-sm font-medium text-slate-300">{ship.name}</p>
        <p className="text-xs text-slate-500">{ship.className}</p>

        <div className="relative mx-auto mt-5 h-36 w-40 overflow-hidden">
          <div className="sunk-modal-smoke" />
          <div className="sunk-modal-ship">
            {ship.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ship.profileImageUrl} alt="" className="max-h-24 max-w-full object-contain" />
            ) : (
              <div className="h-14 w-28 rounded-sm bg-slate-600" />
            )}
          </div>
          <div className="sunk-modal-waterline" />
          <span className="sunk-modal-bubble" style={{ left: "32%", animationDelay: "0.1s" }} />
          <span className="sunk-modal-bubble" style={{ left: "48%", animationDelay: "0.9s" }} />
          <span className="sunk-modal-bubble" style={{ left: "62%", animationDelay: "1.6s" }} />
          <span className="sunk-modal-bubble" style={{ left: "42%", animationDelay: "2.3s" }} />
        </div>

        <button onClick={onClose} className="mt-4 rounded-md border border-slate-700 px-4 py-1.5 text-sm hover:bg-slate-900">
          Fermer
        </button>
      </div>
    </div>
  );
}
