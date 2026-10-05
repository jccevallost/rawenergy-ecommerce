import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Completa las cabeceras de Azure Static Web Apps al compilar (C62, S06). La política de
 * contenido (CSP) necesita el origen de la API, que cambia entre local y producción:
 * `public/staticwebapp.config.json` lleva el marcador __API_ORIGIN__ y aquí se reemplaza
 * por el origen de VITE_GRAPHQL_URL (por omisión, la API local en el puerto 4000).
 */
export function staticHeaders(): Plugin {
  let file = "";
  let origin = "http://localhost:4000";
  return {
    name: "rawenergy-static-headers",
    apply: "build",
    configResolved(config) {
      file = resolve(config.root, config.build.outDir, "staticwebapp.config.json");
      const api = config.env.VITE_GRAPHQL_URL as string | undefined;
      if (api) origin = new URL(api).origin;
    },
    closeBundle() {
      if (!existsSync(file)) return;
      writeFileSync(file, readFileSync(file, "utf8").replaceAll("__API_ORIGIN__", origin));
    }
  };
}

/**
 * Direcciones absolutas de `index.html` (vista previa al compartir, C62): __WEB_URL__ se
 * reemplaza por VITE_WEB_URL sin barra final. Sin la variable queda una ruta relativa.
 */
export function siteUrl(): Plugin {
  let base = "";
  let api = "http://localhost:4000";
  return {
    name: "rawenergy-site-url",
    configResolved(config) {
      base = String(config.env.VITE_WEB_URL ?? "").replace(/\/$/, "");
      if (config.env.VITE_GRAPHQL_URL) api = new URL(String(config.env.VITE_GRAPHQL_URL)).origin;
    },
    // __API_ORIGIN__: conexión anticipada a la API (C64, `preconnect`).
    transformIndexHtml(html) { return html.replaceAll("__WEB_URL__", base).replaceAll("__API_ORIGIN__", api); }
  };
}
