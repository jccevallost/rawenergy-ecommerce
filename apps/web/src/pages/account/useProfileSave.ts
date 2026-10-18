import { useState } from "react";
import { type DocumentNode, useApolloClient } from "@apollo/client";
import { type CustomerProfile, MY_PROFILE } from "@vital-forge/shared-logic";
import { fieldErrorsOf, friendlyError, isConflict } from "../../lib/errors";

export type SaveState = { status: "idle" | "saving" | "saved" | "error" | "conflict"; message: string; fields: Record<string, string> };
const idle: SaveState = { status: "idle", message: "", fields: {} };

/**
 * CU06: guardado de un bloque del perfil. Cada escritura lleva la revisión leída; si otra pestaña guardó
 * antes, se carga la versión actual sin borrar lo que la persona escribió y se le pide revisar y volver a
 * guardar. El perfil devuelto reemplaza el de la caché: no hace falta otra consulta.
 */
export function useProfileSave() {
  const client = useApolloClient();
  const [state, setState] = useState<SaveState>(idle);
  const save = async <T,>(mutation: DocumentNode, variables: Record<string, unknown>, pick: (data: T) => CustomerProfile, saved: string | ((data: T) => string)) => {
    setState({ status: "saving", message: "", fields: {} });
    try {
      const { data } = await client.mutate<T>({ mutation, variables });
      client.writeQuery({ query: MY_PROFILE, data: { myProfile: pick(data!) } });
      setState({ status: "saved", message: typeof saved === "string" ? saved : saved(data!), fields: {} });
      return { data: data!, fields: {} as Record<string, string> };
    } catch (error) {
      if (isConflict(error)) {
        await client.query({ query: MY_PROFILE, fetchPolicy: "network-only" }).catch(() => undefined);
        setState({ status: "conflict", message: "Tus datos cambiaron en otra pestaña o dispositivo. Cargamos la versión actual: revisa tus cambios y vuelve a guardar.", fields: {} });
        return { data: null, fields: {} as Record<string, string> };
      }
      const fields = fieldErrorsOf(error);
      setState({ status: "error", message: Object.keys(fields).length ? "Revisa los datos marcados." : friendlyError(error, "No pudimos guardar. Vuelve a intentarlo."), fields });
      return { data: null, fields };
    }
  };
  return { ...state, save, setFields: (fields: Record<string, string>) => setState({ status: "error", message: "Revisa los datos marcados.", fields }), reset: () => setState(idle) };
}
