import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { assetManifest } from "./vite-asset-manifest";
import { siteUrl, staticHeaders } from "../../scripts/static-headers";
// "spa": el servidor de desarrollo y `vite preview` responden index.html para
// /catalogo y /producto/<slug>, igual que la reescritura de staticwebapp.config.json en Azure.
export default defineConfig({ plugins: [react(), assetManifest(), staticHeaders(), siteUrl()], appType: "spa" });
