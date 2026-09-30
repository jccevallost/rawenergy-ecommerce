import { ApolloError } from "@apollo/client";

type NetworkFailure = Error & { statusCode?: number; result?: { errors?: Array<{ message?: string }> } };

const RATE_LIMITED = "Demasiadas solicitudes seguidas. Espera un minuto y vuelve a intentarlo.";

/** Texto para la persona: explica esperas por límite y cortes de red en vez de mostrar errores técnicos. */
export function friendlyError(error: unknown, fallback: string) {
  if (error instanceof ApolloError) {
    const limited = error.graphQLErrors.find(issue => issue.extensions?.code === "RATE_LIMITED");
    if (limited) return limited.message;
    const network = error.networkError as NetworkFailure | null;
    if (network?.statusCode === 429) return network.result?.errors?.[0]?.message ?? RATE_LIMITED;
    if (network) return "No hay conexión con la tienda. Revisa tu internet y vuelve a intentarlo.";
    return error.graphQLErrors[0]?.message ?? fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
