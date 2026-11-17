import type { MetadataRoute } from "next";

/** Lets "Add to Home Screen" install the app with its own name, icon and full-screen window. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "My Money",
    short_name: "Money",
    description: "Local personal finance dashboard",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#0F6B5C",
    background_color: "#F6F6F3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
