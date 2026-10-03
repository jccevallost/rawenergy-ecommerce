import { env } from "../config/env.js";

// Las fotos subidas al panel se guardan con la dirección que tenía la API en ese
// momento (por ejemplo http://localhost:4000 en una prueba local). Al servirlas se
// rehace la dirección con PUBLIC_API_URL para que sigan cargando al publicar o al
// cambiar de dominio. Solo se tocan las rutas de este servidor: /media/ seguido del
// identificador de 32 caracteres hexadecimales que asigna mediaService.
const OWN_MEDIA = /^(?:https?:\/\/[^/?#]+)?(\/media\/[a-f0-9]{32}(?:\?[^#]*)?)$/;

export function publicMediaUrl<T extends string | null | undefined>(url: T): T {
  if (!url || !env.PUBLIC_API_URL) return url;
  const match = OWN_MEDIA.exec(url);
  return (match ? `${env.PUBLIC_API_URL}${match[1]}` : url) as T;
}
