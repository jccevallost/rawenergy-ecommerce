import { configDefaults, defineConfig } from "vitest/config";

// Vitest 4 ya no excluye dist/ por omisión: sin esto también correría las pruebas compiladas (C61).
export default defineConfig({ test: { exclude: [...configDefaults.exclude, "**/dist/**"] } });
