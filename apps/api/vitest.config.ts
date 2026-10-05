import { configDefaults, defineConfig } from "vitest/config";

// Vitest 4 ya no excluye dist/ por omisión: sin esto también correría las pruebas compiladas (C61).
// Las pruebas de bloqueo hacen ~30 accesos con scrypt (p=5): ~3 s en local y más de 5 s en el runner de GitHub (C72).
export default defineConfig({ test: { exclude: [...configDefaults.exclude, "**/dist/**"], testTimeout: 30_000 } });
