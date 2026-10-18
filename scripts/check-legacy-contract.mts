// CU13: ¿la tienda y el panel publicados (commit de referencia) siguen funcionando contra el esquema nuevo?
// Lee las operaciones de ese commit con `git show` (no toca el árbol de trabajo) y las valida contra typeDefs.
// Uso: node --import tsx scripts/check-legacy-contract.mts [commit]   (por omisión 7c786e2)
import { execFileSync } from "node:child_process";
import { buildASTSchema, parse, validate } from "graphql";
import { typeDefs } from "../apps/api/src/graphql/typeDefs.ts";

const ref = process.argv[2] ?? "7c786e2";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const schema = buildASTSchema(parse(typeDefs));
const files = git("ls-tree", "-r", "--name-only", ref, "packages/shared-logic/src", "apps/web/src", "apps/admin/src").split("\n").filter(path => /\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path));
const raw = new Map<string, string>();
const found: Array<{ where: string; body: string }> = [];
for (const path of files) {
  const text = git("show", `${ref}:${path}`);
  for (const match of text.matchAll(/(?:const\s+(\w+)\s*=\s*)?gql`([^`]*)`/g)) {
    if (match[1]) raw.set(match[1], match[2]!);
    found.push({ where: `${path}${match[1] ? `: ${match[1]}` : ""}`, body: match[2]! });
  }
}
const expand = (body: string, seen: string[] = []): string => body.replace(/\$\{(\w+)\}/g, (_, name: string) => {
  const fragment = raw.get(name);
  if (fragment === undefined || seen.includes(name)) throw new Error(`no se encontró el fragmento ${name}`);
  return expand(fragment, [...seen, name]);
});
// Cambios no aditivos aceptados y documentados (CU01/CU04): la tienda publicada no ofrece el alta porque la API
// tiene las cuentas apagadas; con cuentas encendidas se publica la tienda nueva.
const accepted = new Set(["REGISTER"]);
const documents = found.map(({ where, body }) => ({ where, source: expand(body) })).filter(({ source }) => /\b(query|mutation|subscription)\b|^\s*\{/.test(source));
let failures = 0, acceptedFailures = 0;
for (const { where, source } of documents) {
  const errors = validate(schema, parse(source));
  if (!errors.length) continue;
  const name = where.split(": ")[1] ?? "";
  if (accepted.has(name)) { acceptedFailures++; console.log(`aceptado  ${where}: ${errors[0]!.message}`); continue; }
  failures++;
  console.log(`ERROR     ${where}`);
  for (const error of errors) console.log(`   ${error.message}`);
}
console.log(`${ref}: ${documents.length} operaciones revisadas; ${failures} incompatibles; ${acceptedFailures} cambios aceptados y documentados.`);
process.exitCode = failures ? 1 : 0;
