import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { assetManifest } from "./vite-asset-manifest";
// "spa": el servidor de desarrollo y `vite preview` responden index.html para
// /catalogo y /producto/<slug>, igual que la reescritura de netlify.toml.
export default defineConfig({ plugins: [react(), assetManifest()], appType: "spa" });
