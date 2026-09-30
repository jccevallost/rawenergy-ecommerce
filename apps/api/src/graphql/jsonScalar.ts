import { GraphQLScalarType, Kind, type ValueNode } from "graphql";

const parseLiteral = (ast: ValueNode): unknown => {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN: return ast.value;
    case Kind.INT:
    case Kind.FLOAT: return Number(ast.value);
    case Kind.NULL: return null;
    case Kind.LIST: return ast.values.map(parseLiteral);
    case Kind.OBJECT: return Object.fromEntries(ast.fields.map((field) => [field.name.value, parseLiteral(field.value)]));
    default: return undefined;
  }
};

export const jsonScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Payload JSON validado estrictamente por Zod",
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral
});
