"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Pas grave si ça échoue : le site fonctionne sans mode hors-ligne.
      });
    }
  }, []);

  return null;
}
