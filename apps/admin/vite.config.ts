import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { staticHeaders } from "../../scripts/static-headers";
export default defineConfig({ plugins: [react(), staticHeaders()], appType: "mpa" });
