import { type CSSProperties, type ReactNode, useState } from "react";

type AssetImageProps = {
  candidates: Array<string | undefined | null>;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  fallback?: ReactNode;
  style?: CSSProperties;
};

export function AssetImage({ candidates, alt, className, loading = "lazy", fallback, style }: AssetImageProps) {
  const sources = Array.from(new Set(candidates.filter(Boolean) as string[]));
  const sourceKey = sources.join("|");
  // El intento y la carga se guardan junto a la lista a la que pertenecen: si la
  // lista cambia se vuelve a empezar sin un efecto que pueda llegar tarde y dejar
  // oculta una imagen que ya cargó desde la caché.
  const [attempt, setAttempt] = useState({ key: sourceKey, index: 0 });
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const index = attempt.key === sourceKey ? attempt.index : 0;
  const source = sources[index];

  if (!source) return fallback ? <span role={alt ? "img" : undefined} aria-label={alt ? `${alt}. Imagen no disponible.` : undefined}>{fallback}</span> : null;

  const fadeClass = loading === "lazy" ? `asset-image${loadedSource === source ? " asset-image-loaded" : ""}` : "";
  return (
    <img
      className={`${className ?? ""} ${fadeClass}`.trim()}
      src={source}
      alt={alt}
      loading={loading}
      decoding="async"
      style={style}
      onLoad={() => setLoadedSource(source)}
      onError={() => setAttempt({ key: sourceKey, index: index + 1 })}
    />
  );
}
