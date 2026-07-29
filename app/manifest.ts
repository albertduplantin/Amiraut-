import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Les Semaines de l'Hexagone",
    short_name: "Hexagone",
    description: "Séjours de jeux de société — Cercle de Stratégie",
    start_url: "/",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#1d4645",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
  };
}
