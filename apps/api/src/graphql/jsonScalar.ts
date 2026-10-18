import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from "graphql";

// Niveles de anidación aceptados en un argumento JSON (D04). Los datos reales del panel
// (producto con presentaciones y lotes, importación, gastos) no pasan de 6; el límite deja
// margen y corta antes de que la auditoría o Zod recorran recursivamente miles de niveles.
export const MAX_JSON_DEPTH = 16;

const tooDeep = () => new GraphQLError(`Los datos tienen demasiados niveles (máximo ${MAX_JSON_DEPTH}).`, { extensions: { code: "BAD_USER_INPUT" } });

/** Recorre el valor con una pila propia, sin recursión, y rechaza más de MAX_JSON_DEPTH niveles. */
export function assertJsonDepth(value: unknown) {
  const pending: Array<[unknown, number]> = [[value, 1]];
  while (pending.length) {
    const [current, depth] = pending.pop()!;
    if (current === null || typeof current !== "object") continue;
    if (depth > MAX_JSON_DEPTH) throw tooDeep();
    for (const child of Object.values(current)) pending.push([child, depth + 1]);
  }
  return value;
}

const parseLiteral = (ast: ValueNode, depth = 1): unknown => {
  if ((ast.kind === Kind.LIST || ast.kind === Kind.OBJECT) && depth > MAX_JSON_DEPTH) throw tooDeep();
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN: return ast.value;
    case Kind.INT:
    case Kind.FLOAT: return Number(ast.value);
    case Kind.NULL: return null;
    case Kind.LIST: return ast.values.map((item) => parseLiteral(item, depth + 1));
    case Kind.OBJECT: return Object.fromEntries(ast.fields.map((field) => [field.name.value, parseLiteral(field.value, depth + 1)]));
    default: return undefined;
  }
};

export const jsonScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Payload JSON validado estrictamente por Zod",
  serialize: (value) => value,
  parseValue: assertJsonDepth,
  parseLiteral: (ast) => parseLiteral(ast)
});
