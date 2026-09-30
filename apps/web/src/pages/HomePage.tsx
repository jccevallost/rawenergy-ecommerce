import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useQuery } from "@apollo/client";
import { ArrowRight, ClipboardCheck, Landmark, ShoppingCart } from "lucide-react";
import { ACTIVE_CAMPAIGNS, type Campaign, CHECKOUT_INFO, type CheckoutInfo, type Product, useProductsByGoal, useProductSearch } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { AssetImage } from "../components/AssetImage";
import { HeroCarousel, HeroSkeleton, type HeroSlide } from "../components/HeroCarousel";
import { ProductRail } from "../components/ProductRail";
import { brandLogoCandidates, featuredBrands } from "../lib/assetCatalog";
import { campaignHref, catalogHref, productHref } from "../lib/catalogUrl";
import { friendlyError } from "../lib/errors";
import { goals } from "../lib/goals";
import { readRecent } from "../lib/recentlyViewed";
import { Link, usePageEntry } from "../lib/router";
import { storePromises } from "../lib/storePromises";
import { freeShippingText } from "../lib/commerceText";

// Mensajes generales cuando no hay campañas activas (o no cargan): nunca queda vacía la portada.
const fallbackSlides = [
  { key: "general", eyebrow: "Suplementos deportivos", title: "Encuentra tu suplemento en minutos", message: "Compara precios, presentaciones y disponibilidad. Compra sin crear una cuenta.", ctaLabel: "Ver catálogo", goal: "", theme: "noche" as const },
  { key: "fuerza", eyebrow: "Fuerza y músculo", title: "Proteínas y creatinas para tu rutina de fuerza", message: "Revisa ingredientes y porciones en cada producto antes de elegir tu presentación.", ctaLabel: "Ver productos de fuerza", goal: "desarrollo-muscular", theme: "oro" as const },
  { key: "energia", eyebrow: "Energía", title: "Prepara tu próximo entrenamiento", message: "Preentrenos y productos de energía con su disponibilidad visible antes de comprar.", ctaLabel: "Ver productos de energía", goal: "energia", theme: "claro" as const }
];

function fallbackHero(products: Product[]): HeroSlide[] {
  const used = new Set<string>();
  return fallbackSlides.map(slide => {
    const pick = products.filter(product => !used.has(product.id) && (!slide.goal || product.goals.some(goal => goal.slug === slide.goal))).slice(0, 3);
    pick.forEach(product => used.add(product.id));
    return { ...slide, href: catalogHref(slide.goal ? { goals: [slide.goal] } : {}), products: pick.length ? pick : products.slice(0, 3) };
  });
}

const campaignSlide = (campaign: Campaign): HeroSlide => ({
  key: campaign.id, eyebrow: campaign.eyebrow, title: campaign.title, message: campaign.message, ctaLabel: campaign.ctaLabel,
  href: campaignHref(campaign.slug), theme: campaign.theme.toLowerCase() as HeroSlide["theme"], imageUrl: campaign.imageUrl, products: campaign.products
});

/** Cada diapositiva muestra primero productos que las anteriores no mostraron. */
function varied(slides: HeroSlide[]) {
  const shown = new Set<string>();
  return slides.map(slide => {
    const products = [...slide.products.filter(product => !shown.has(product.id)), ...slide.products.filter(product => shown.has(product.id))];
    products.slice(0, 3).forEach(product => shown.add(product.id));
    return { ...slide, products };
  });
}

function GoalTabs() {
  const [active, setActive] = useState<string>(goals[0].slug);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const { data, loading, error, refetch } = useProductsByGoal(active, 8);
  const goal = goals.find(item => item.slug === active)!;
  // Patrón de pestañas: flechas mueven entre objetivos, Tab entra al carril.
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: goals.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key]! + goals.length) % goals.length;
    setActive(goals[next]!.slug);
    tabs.current[next]?.focus();
  };
  return (
    <ProductRail
      title="Recomendados por objetivo"
      subtitle="Elige tu objetivo y compara las opciones disponibles."
      products={data}
      loading={loading}
      error={error && <>{friendlyError(error, "No pudimos cargar estos productos.")} <button type="button" className="btn btn-link" onClick={() => void refetch()}>Reintentar</button></>}
      viewAll={{ to: catalogHref({ goals: [active] }), label: `Ver todo en ${goal.label}` }}
      panelProps={{ role: "tabpanel", id: "panel-objetivo", "aria-labelledby": `tab-${active}` }}>
      <div className="tabs" role="tablist" aria-label="Objetivo">
        {goals.map((item, index) => (
          <button key={item.slug} ref={element => { tabs.current[index] = element; }} type="button" role="tab" id={`tab-${item.slug}`}
            aria-selected={item.slug === active} aria-controls="panel-objetivo" tabIndex={item.slug === active ? 0 : -1}
            onClick={() => setActive(item.slug)} onKeyDown={event => onKeyDown(event, index)}>
            <item.icon size={18} aria-hidden="true" /> {item.label}
          </button>
        ))}
      </div>
    </ProductRail>
  );
}

function BecauseYouViewed() {
  const recent = useMemo(readRecent, []);
  const last = recent.find(item => item.goal);
  const { data, loading } = useProductsByGoal(last?.goal ?? "", 10, { skip: !last });
  const seen = new Set(recent.map(item => item.id));
  const products = data.filter(product => !seen.has(product.id));
  if (!last || (!loading && !products.length)) return null;
  return <ProductRail title={`Porque viste ${last.title}`} subtitle={last.goalName ? `Más opciones en ${last.goalName}.` : undefined} products={products} loading={loading} viewAll={{ to: catalogHref({ goals: [last.goal!] }), label: "Ver más" }} />;
}

function RecentlyViewed() {
  const recent = useMemo(readRecent, []);
  if (!recent.length) return null;
  return (
    <section className="container recent" aria-labelledby="recent-title">
      <h2 id="recent-title">Vistos recientemente</h2>
      <ul>
        {recent.map(item => (
          <li key={item.id}>
            <Link to={productHref(item.slug)}>
              <AssetImage candidates={[item.image]} alt="" fallback={<span className="photo-fallback" />} />
              <span><small>{item.brand}</small>{item.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HowToBuy() {
  const { data } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const info = data?.checkoutInfo;
  const fee = (method: string) => info?.shippingRates.find(rate => rate.method === method)?.fee;
  const express = fee("EXPRESS_QUITO_VALLES");
  const national = fee("SERVIENTREGA_NATIONAL");
  const steps = [
    { icon: ShoppingCart, title: "Elige y agrega", text: "Selecciona sabor y tamaño. No necesitas crear una cuenta." },
    { icon: ClipboardCheck, title: "Registra tu pedido", text: "Escribe tus datos de entrega. Verás el envío y el total antes de confirmar." },
    { icon: Landmark, title: "Transfiere y recibe", text: "Te mostramos los datos bancarios. Despachamos cuando validamos el pago." }
  ];
  return (
    <section className="how container" id="envios" aria-labelledby="how-title">
      <h2 id="how-title">Así compras en RawEnergy</h2>
      <ol className="how-steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="how-icon"><step.icon size={22} aria-hidden="true" /></span>
            <b><span className="sr-only">Paso {index + 1}: </span>{step.title}</b>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
      <div className="how-delivery">
        <h3>Envíos y costos</h3>
        <ul>
          {info && freeShippingText(info) && <li><b>{freeShippingText(info)}.</b></li>}
          {express !== undefined && <li><b>Quito y Valles (express):</b> {formatMoney(express)}.</li>}
          {national !== undefined && <li><b>Resto del país (Servientrega):</b> {formatMoney(national)}.</li>}
          {!info && <li>El costo de envío se calcula antes de confirmar tu pedido.</li>}
        </ul>
        <ul className="promises">
          {storePromises.map(promise => <li key={promise.title}><promise.icon size={20} aria-hidden="true" /><span><b>{promise.title}</b>{promise.detail}</span></li>)}
        </ul>
      </div>
    </section>
  );
}

export function HomePage() {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry("", heading);
  const available = useProductSearch({ inStock: true }, 12);
  const featured = useProductSearch({ featured: true, inStock: true }, 12);
  const campaigns = useQuery<{ activeCampaigns: Campaign[] }>(ACTIVE_CAMPAIGNS, { variables: { limit: 8 } });
  const live = (campaigns.data?.activeCampaigns ?? []).filter(campaign => campaign.products.length > 0);
  const slides = live.length ? varied(live.slice(0, 5).map(campaignSlide)) : fallbackHero(available.products);
  const spotlight = live[0];
  const useFeatured = featured.loading || featured.products.length > 0;
  const rail = useFeatured ? featured : available;
  return (
    <>
      <h1 className="sr-only" ref={heading} tabIndex={-1}>RawEnergy EC, tienda de suplementos deportivos</h1>
      {campaigns.loading && !campaigns.data ? <HeroSkeleton /> : <HeroCarousel slides={slides} />}
      <nav className="container goal-tiles" aria-label="Comprar por objetivo">
        {goals.map(goal => (
          <Link key={goal.slug} to={catalogHref({ goals: [goal.slug] })} className="goal-tile">
            <span className="goal-tile-icon"><goal.icon size={22} aria-hidden="true" /></span>
            <span><b>{goal.label}</b><small>{goal.note}</small></span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        ))}
      </nav>
      <ProductRail
        title={useFeatured ? "Destacados de la tienda" : "Disponibles ahora"}
        subtitle={useFeatured ? "Selección de la tienda con existencias." : "Productos con existencias para comprar hoy."}
        products={rail.products}
        loading={rail.loading && !rail.products.length}
        error={rail.error && <>{friendlyError(rail.error, "No pudimos cargar los productos.")} <button type="button" className="btn btn-link" onClick={() => void rail.refetch()}>Reintentar</button></>}
        viewAll={{ to: catalogHref({ inStock: true }), label: "Ver todo lo disponible" }} />
      {spotlight && <ProductRail title={spotlight.title} subtitle={spotlight.eyebrow} products={spotlight.products} viewAll={{ to: campaignHref(spotlight.slug), label: spotlight.ctaLabel }} />}
      <BecauseYouViewed />
      <GoalTabs />
      <RecentlyViewed />
      <section className="container brands" id="marcas" aria-labelledby="brands-title">
        <div className="section-head">
          <h2 id="brands-title">Compra por marca</h2>
          <Link to={catalogHref()} className="btn btn-link">Ver catálogo <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <ul className="brand-grid">
          {featuredBrands.map(brand => (
            <li key={brand.name}>
              <Link to={catalogHref({ brands: [brand.name] })} className="brand-tile" aria-label={`Productos de ${brand.name}`}>
                <AssetImage candidates={brandLogoCandidates(brand)} alt="" fallback={<b>{brand.name}</b>} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <HowToBuy />
    </>
  );
}
