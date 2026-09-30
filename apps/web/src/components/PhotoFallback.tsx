import { Package } from "lucide-react";
import { AssetImage } from "./AssetImage";
import { brandLogoFor } from "../lib/assetCatalog";

/** Recuadro sin foto de producto: logo de la marca (o su nombre), nunca una foto ajena. */
export function PhotoFallback({ brand, size = 40 }: { brand?: string; size?: number }) {
  const icon = <span className="photo-fallback"><Package size={size} aria-hidden="true" />{brand && <small>{brand}</small>}</span>;
  if (!brand) return icon;
  return <span className="photo-fallback photo-fallback-brand"><AssetImage candidates={brandLogoFor(brand)} alt="" loading="eager" fallback={icon} /></span>;
}
