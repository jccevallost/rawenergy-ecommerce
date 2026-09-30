import { GraphQLError, Kind, type ASTVisitor, type FragmentDefinitionNode, type SelectionSetNode, type ValidationContext } from "graphql";

// El limite de profundidad no restringe la anchura: con alias, una peticion puede
// repetir la misma operacion cientos de veces y saltarse el limitador HTTP.
// El panel y la tienda piden un campo raiz por operacion.
export const MAX_ROOT_FIELDS = 10;
export const SENSITIVE_MUTATIONS = new Set(["login", "register", "createCheckoutOrder", "requestPasswordReset", "resetPassword"]);

const rootFieldNames = (set: SelectionSetNode, fragments: Map<string, FragmentDefinitionNode>, seen = new Set<string>()): string[] =>
  set.selections.flatMap(selection => {
    if (selection.kind === Kind.FIELD) return selection.name.value === "__typename" ? [] : [selection.name.value];
    if (selection.kind === Kind.INLINE_FRAGMENT) return rootFieldNames(selection.selectionSet, fragments, seen);
    const name = selection.name.value;
    const fragment = fragments.get(name);
    if (seen.has(name) || !fragment) return [];
    seen.add(name);
    return rootFieldNames(fragment.selectionSet, fragments, seen);
  });

// Apollo publica estos errores con el codigo GRAPHQL_VALIDATION_FAILED.
export const operationWidthRule = (context: ValidationContext): ASTVisitor => {
  const fragments = new Map(context.getDocument().definitions
    .filter((definition): definition is FragmentDefinitionNode => definition.kind === Kind.FRAGMENT_DEFINITION)
    .map(definition => [definition.name.value, definition]));
  return {
    OperationDefinition(node) {
      const fields = rootFieldNames(node.selectionSet, fragments);
      if (fields.length > MAX_ROOT_FIELDS) {
        context.reportError(new GraphQLError(`La solicitud pide ${fields.length} operaciones; el máximo es ${MAX_ROOT_FIELDS}.`, { nodes: [node] }));
      }
      if (node.operation === "mutation" && fields.filter(name => SENSITIVE_MUTATIONS.has(name)).length > 1) {
        context.reportError(new GraphQLError("Solo se permite un acceso, registro o pedido por solicitud.", { nodes: [node] }));
      }
    }
  };
};
