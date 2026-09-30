import { useEffect, useRef } from "react";
import { useQuery } from "@apollo/client";
import { ACTIVE_CAMPAIGNS, CAMPAIGN_BY_SLUG, type Campaign } from "@vital-forge/shared-logic";
import { AssetImage } from "../components/AssetImage";
import { ProductCard } from "../components/ProductCard";
import { ProductSkeleton } from "../components/ProductSkeleton";
import { campaignHref, catalogHref } from "../lib/catalogUrl";
import { friendlyError } from "../lib/errors";
import { Link, usePageEntry } from "../lib/router";

function CampaignView({ campaign }: { campaign: Campaign }) {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry(campaign.title, heading);
  const others = useQuery<{ activeCampaigns: Campaign[] }>(ACTIVE_CAMPAIGNS, { variables: { limit: 8 } });
  const more = (others.data?.activeCampaigns ?? []).filter(item => item.id !== campaign.id && item.products.length);
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previous = meta?.content;
    if (meta) meta.content = campaign.message.slice(0, 160);
    return () => { if (meta && previous !== undefined) meta.content = previous; };
  }, [campaign.message]);
  return (
    <>
      <section className={`campaign-hero theme-${campaign.theme.toLowerCase()}`}>
        <div className="container campaign-hero-inner">
          <div>
            <nav className="breadcrumb" aria-label="Ruta de navegación"><ol><li><Link to="/">Inicio</Link></li><li aria-current="page">{campaign.eyebrow}</li></ol></nav>
            <span className="eyebrow">{campaign.eyebrow}</span>
            <h1 ref={heading} tabIndex={-1}>{campaign.title}</h1>
            <p>{campaign.message}</p>
          </div>
          {campaign.imageUrl && <AssetImage candidates={[campaign.imageUrl]} alt="" loading="eager" className="campaign-banner" />}
        </div>
      </section>
      <div className="container campaign-body">
        <div className="section-head">
          <h2>Selección de la campaña</h2>
          <p className="catalog-count">{campaign.products.length} {campaign.products.length === 1 ? "producto" : "productos"}</p>
        </div>
        {campaign.products.length ? (
          <ul className="product-grid">
            {campaign.products.map((product, index) => <li key={product.id}><ProductCard product={product} priority={index < 4} /></li>)}
          </ul>
        ) : (
          <div className="empty-state">
            <h2>Por ahora no hay productos disponibles en esta campaña</h2>
            <p>Revisa el catálogo completo; las existencias se actualizan cada día.</p>
            <Link to={catalogHref()} className="btn btn-primary">Ver catálogo</Link>
          </div>
        )}
        {!!more.length && (
          <nav className="campaign-more" aria-label="Otras campañas">
            <h2>Otras campañas</h2>
            <ul>{more.map(item => <li key={item.id}><Link to={campaignHref(item.slug)} className={`campaign-chip theme-${item.theme.toLowerCase()}`}><small>{item.eyebrow}</small>{item.title}</Link></li>)}</ul>
          </nav>
        )}
      </div>
    </>
  );
}

function CampaignStatus({ missing, error, onRetry }: { missing: boolean; error?: unknown; onRetry: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry(missing ? "Campaña no disponible" : error ? "Campaña sin conexión" : "Cargando campaña", heading);
  if (!missing && !error) return <div className="container"><h1 ref={heading} tabIndex={-1} className="loading-line">Cargando campaña…</h1><ul className="product-grid">{Array.from({ length: 4 }, (_, index) => <li key={index}><ProductSkeleton /></li>)}</ul></div>;
  return (
    <div className="container status-page">
      <h1 ref={heading} tabIndex={-1}>{missing ? "Esta campaña ya no está disponible" : "No pudimos abrir la campaña"}</h1>
      <p>{missing ? "Puede que haya terminado o que el enlace esté incompleto. Estos productos siguen en el catálogo." : friendlyError(error, "Vuelve a intentarlo en unos segundos.")}</p>
      <div className="empty-actions">
        {!missing && <button type="button" className="btn btn-primary" onClick={onRetry}>Reintentar</button>}
        <Link to={catalogHref()} className={missing ? "btn btn-primary" : "btn btn-outline"}>Ver catálogo</Link>
        <Link to="/" className="btn btn-outline">Ir al inicio</Link>
      </div>
    </div>
  );
}

export function CampaignPage({ slug }: { slug: string }) {
  const { data, loading, error, refetch } = useQuery<{ campaign: Campaign | null }>(CAMPAIGN_BY_SLUG, { variables: { slug, limit: 24 } });
  if (data?.campaign) return <CampaignView key={data.campaign.id} campaign={data.campaign} />;
  return <CampaignStatus missing={!!data && !data.campaign} error={loading ? undefined : error} onRetry={() => void refetch()} />;
}
