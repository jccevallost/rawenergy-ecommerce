import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Vitest 4 ya no excluye dist/ por omisión: sin esto también correría lo compilado (C61).
export default mergeConfig(viteConfig, defineConfig({ test: { exclude: [...configDefaults.exclude, "**/dist/**"] } }));
