const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_URL ?? "http://localhost:4000/graphql";
export const MEDIA_URL = GRAPHQL_URL.replace(/\/graphql\/?$/, "") + "/media";

const MAX_SIDE = 1400;
const QUALITY = 0.82;

const canEncodeWebp = () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  return canvas.toDataURL("image/webp").startsWith("data:image/webp");
};

/**
 * Reduce la foto antes de subirla. Una camara de telefono entrega archivos de
 * varios megabytes que nadie necesita en una ficha de producto, y subirlos tal
 * cual solo hace lento el catalogo.
 */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); return file; }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const type = canEncodeWebp() ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
  // Si el original ya pesaba menos que el recomprimido, no tiene sentido crecer.
  return blob && (scale < 1 || blob.size < file.size) ? blob : file;
}

export const thumbnailUrl = (url: string) => /\/media\/[a-f0-9]{32}$/.test(url) ? `${url}?size=thumb` : url;

export async function uploadImage(file: File, onProgress?: (progress: number) => void): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: máximo 20 MB antes de optimizar`);
  if (!file.type.startsWith("image/")) throw new Error(`${file.name}: no es una imagen`);
  const blob = await downscale(file).catch(() => file);
  if (blob.size > 5 * 1024 * 1024) throw new Error(`${file.name}: no se pudo reducir a menos de 5 MB; exporta a JPEG, PNG o WebP`);
  const token = localStorage.getItem("rawenergy-token");
  onProgress?.(10);
  return new Promise<string>((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open("POST",MEDIA_URL);xhr.timeout=90000;xhr.setRequestHeader("Content-Type",blob.type||file.type);if(token)xhr.setRequestHeader("Authorization",`Bearer ${token}`);
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(10+Math.round(e.loaded/e.total*85));};
    xhr.onerror=()=>reject(new Error(`${file.name}: error de conexión. Puedes reintentar.`));xhr.ontimeout=()=>reject(new Error(`${file.name}: tiempo de espera agotado. Puedes reintentar.`));
    xhr.onload=()=>{let payload:{url?:string;error?:string}={};try{payload=JSON.parse(xhr.responseText);}catch{}if(xhr.status<200||xhr.status>=300||!payload.url){reject(new Error(`${file.name}: ${payload.error??"no se pudo subir"}`));return;}onProgress?.(100);resolve(payload.url);};xhr.send(blob);
  });
}
