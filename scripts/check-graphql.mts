// Valida cada operación GraphQL de la tienda, el panel y la lógica compartida contra el
// esquema de la API (C62). Encontró `storeSettings { freeShippingMethods }`, que el panel
// pedía desde C31 sin estar en el esquema: Configuración respondía 400.
// Uso: node --import tsx scripts/check-graphql.mts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildASTSchema, parse, validate } from "graphql";
import { typeDefs } from "../apps/api/src/graphql/typeDefs.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = buildASTSchema(parse(typeDefs));

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (name === "node_modules" || name === "dist") return [];
  return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
});
const files = [...walk(join(root, "packages/shared-logic/src")), ...walk(join(root, "apps/admin/src")), ...walk(join(root, "apps/web/src"))];

// Cada `const NOMBRE = gql`...`` de los tres paquetes, por nombre, para completar los fragmentos interpolados.
const raw = new Map<string, string>();
const found: Array<{ where: string; body: string }> = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/(?:const\s+(\w+)\s*=\s*)?gql`([^`]*)`/g)) {
    if (match[1]) raw.set(match[1], match[2]!);
    found.push({ where: `${relative(root, file)}${match[1] ? `: ${match[1]}` : ""}`, body: match[2]! });
  }
}
const expand = (body: string, seen: string[] = []): string => body.replace(/\$\{(\w+)\}/g, (_, name: string) => {
  const fragment = raw.get(name);
  if (fragment === undefined || seen.includes(name)) throw new Error(`no se encontró el fragmento ${name}`);
  return expand(fragment, [...seen, name]);
});
const documents = found.map(({ where, body }) => ({ where, source: expand(body) }))
  // Un documento que solo define fragmentos se valida dentro de las operaciones que lo usan.
  .filter(({ source }) => /\b(query|mutation|subscription)\b|^\s*\{/.test(source));

let failures = 0;
for (const { where, source } of documents) {
  let errors: readonly { message: string }[];
  try { errors = validate(schema, parse(source)); } catch (error) { errors = [error as Error]; }
  // Un documento que solo trae un fragmento (sin operación) no se puede validar suelto.
  const real = errors.filter((error) => !/Fragment "\w+" is never used/.test(error.message));
  if (real.length) { failures++; console.error(`✗ ${where}\n  ${real.map((error) => error.message).join("\n  ")}`); }
}
console.log(`${documents.length} operaciones revisadas; ${failures} con errores.`);
process.exit(failures ? 1 : 0);
