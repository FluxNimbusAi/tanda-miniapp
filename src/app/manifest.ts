import type { MetadataRoute } from "next";

// QUALITY WAVE 1 (I2): PWA manifest — completes the World review checklist
// gap (app icon discoverable in-repo, not only via portal upload) and gives
// install/OG crawlers a canonical identity. Colors match the live dark shell.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TandaBill",
    short_name: "Tanda",
    description:
      "Proof-escrow settlement between provably-unique humans. Escrowed on World Chain, settled by contract.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e14",
    theme_color: "#3ec8ff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
