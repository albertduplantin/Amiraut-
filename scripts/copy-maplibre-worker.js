/**
 * Turbopack ne résout pas le worker interne de maplibre-gl automatiquement ;
 * sans lui, aucune couche vectorielle ne se construit (voir GameMap.tsx).
 * On copie les fichiers nécessaires dans public/ à chaque install pour
 * rester synchronisé avec la version installée du package.
 */
const fs = require("fs");
const path = require("path");

const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
const srcDir = path.join(__dirname, "..", "node_modules", "maplibre-gl", "dist");
const destDir = path.join(__dirname, "..", "public");

for (const file of files) {
  const src = path.join(srcDir, file);
  const dest = path.join(destDir, file);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-maplibre-worker] ${src} introuvable, ignoré.`);
    continue;
  }
  fs.copyFileSync(src, dest);
  console.log(`[copy-maplibre-worker] copié ${file}`);
}
