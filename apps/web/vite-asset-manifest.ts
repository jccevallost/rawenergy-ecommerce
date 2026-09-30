import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:asset-manifest";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

const walk = (root: string, dir: string, found: string[]) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, found);
    else if (!entry.name.startsWith(".")) found.push("/" + relative(root, full).split(/[\\/]/).join("/"));
  }
  return found;
};

/**
 * Lista los archivos que existen en public/ y los expone al cliente.
 * Sin esto la web prueba varias extensiones por imagen y cada archivo ausente
 * cuesta una respuesta 404: eran mas de veinte en cada carga.
 */
export function assetManifest(): Plugin {
  let publicDir = "";
  const read = () => {
    try {
      return walk(publicDir, join(publicDir, "assets"), []);
    } catch {
      return [];
    }
  };
  return {
    name: "rawenergy-asset-manifest",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    resolveId: (id) => id === VIRTUAL_ID ? RESOLVED_ID : null,
    load: (id) => id === RESOLVED_ID ? `export const assetManifest = ${JSON.stringify(read())};` : null,
    configureServer(server) {
      // En desarrollo, dejar caer un archivo nuevo en public/assets tiene que
      // reflejarse sin reiniciar el servidor.
      server.watcher.add(join(publicDir, "assets"));
      const invalidate = (file: string) => {
        if (!file.startsWith(join(publicDir, "assets"))) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", invalidate);
      server.watcher.on("unlink", invalidate);
    }
  };
}
