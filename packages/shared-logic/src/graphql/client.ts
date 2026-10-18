import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from "@apollo/client";
import { getMainDefinition } from "@apollo/client/utilities";
import { RetryLink } from "@apollo/client/link/retry";

// El límite de peticiones responde 429 con errores GraphQL. Se entregan como
// tales: cada pantalla muestra «Demasiadas solicitudes…» en lugar de un error
// técnico, y RetryLink no insiste (reintentar un 429 solo alarga el bloqueo).
export const fetchWithRateLimit: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status !== 429) return response;
  const body = await response.clone().text();
  try {
    if (Array.isArray((JSON.parse(body) as { errors?: unknown }).errors)) return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  } catch { /* No es una respuesta GraphQL: se deja como error de red. */ }
  return response;
};

/**
 * VER-01: plataforma y versión del cliente. Las apps nativas añaden a su agente de usuario
 * «RawEnergyShell/<plataforma>/<versión>»; en el navegador se informa la web sin versión mínima.
 */
export function clientHeader(app: "panel" | "tienda") {
  const marker = typeof navigator === "undefined" ? null : /RawEnergyShell\/([a-z][a-z-]{1,30})\/(\d+\.\d+\.\d+)/.exec(navigator.userAgent);
  return marker ? `${marker[1]}/${marker[2]}` : `${app}-web/0.0.0`;
}

export const createGraphQLClient = (uri: string, app: "panel" | "tienda" = "tienda") => {
  const client = clientHeader(app);
  const retryLink = new RetryLink({
    delay: { initial: 350, max: 4_000, jitter: true },
    attempts: { max: 6, retryIf: (error, operation) => { const definition = getMainDefinition(operation.query); return Boolean(error) && definition.kind === "OperationDefinition" && definition.operation === "query"; } }
  });
  const authLink = new ApolloLink((operation, forward) => {
    const token = typeof localStorage === "undefined" ? null : localStorage.getItem("rawenergy-token");
    operation.setContext(({ headers = {} }) => ({
      headers: { ...headers, "x-rawenergy-client": client, ...(token ? { authorization: `Bearer ${token}` } : {}) }
    }));
    return forward(operation);
  });

  return new ApolloClient({
  link: ApolloLink.from([authLink, retryLink, new HttpLink({ uri, fetch: fetchWithRateLimit })]),
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          searchProducts: {
            keyArgs: ["filters"],
            merge: (existing, incoming, { args }) => {
              if (!args?.pagination?.after || !existing) return incoming;
              return { ...incoming, edges: [...existing.edges, ...incoming.edges] };
            }
          }
        }
      }
    }
  }),
  connectToDevTools: true
  });
};
