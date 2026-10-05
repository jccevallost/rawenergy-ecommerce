import { type ReactNode, useRef } from "react";
import { useQuery } from "@apollo/client";
import { CHECKOUT_INFO, type CheckoutInfo, STORE_LEGAL, type StoreLegal } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { type LegalTopic, Link, usePageEntry } from "../lib/router";
import { storePromises } from "../lib/storePromises";
import { formatWhatsapp, whatsappHref } from "../lib/whatsapp";
import { cashOnDeliveryConditions, freeShippingText } from "../lib/commerceText";

// Textos legales redactados con la Ley Orgánica de Protección de Datos Personales
// (LOPDP, 2021) y la Ley Orgánica de Defensa del Consumidor (LODC) de Ecuador, y con
// lo que el sistema hace realmente. Razón social, RUC, dirección y correo salen de
// la configuración (STORE_LEGAL_NAME, STORE_RUC, STORE_ADDRESS, STORE_CONTACT_EMAIL);
// si faltan no se muestran. Revisión por un profesional del derecho recomendada.
export const legalTopics: Record<LegalTopic, string> = {
  terminos: "Términos y condiciones",
  privacidad: "Política de privacidad",
  devoluciones: "Política de cambios y devoluciones",
  envios: "Envíos y pagos"
};

const UPDATED = "26 de septiembre de 2026";

function Contact({ legal }: { legal?: StoreLegal }) {
  if (!legal) return null;
  return (
    <ul className="legal-contact">
      <li><b>{legal.legalName ?? legal.storeName}</b>{legal.legalName && legal.legalName !== legal.storeName ? ` (${legal.storeName})` : ""}</li>
      {legal.ruc && <li>RUC {legal.ruc}</li>}
      {legal.address && <li>{legal.address}</li>}
      {legal.whatsapp && <li>WhatsApp: <a href={whatsappHref(legal.whatsapp, "Hola RawEnergy, tengo una consulta.")} target="_blank" rel="noopener noreferrer">{formatWhatsapp(legal.whatsapp)}</a></li>}
      {legal.email && <li>Correo: <a href={`mailto:${legal.email}`}>{legal.email}</a></li>}
    </ul>
  );
}

function Terms({ legal, info }: { legal?: StoreLegal; info?: CheckoutInfo }) {
  const hours = legal?.reservationHours ?? 24;
  return <>
    <h2>1. Quiénes somos</h2>
    <p>Esta tienda en línea es operada por la siguiente persona responsable, a quien puedes contactar por estos medios:</p>
    <Contact legal={legal} />
    <h2>2. Productos e información</h2>
    <p>Vendemos suplementos deportivos de las marcas publicadas. La información de cada producto (presentación, porción e ingredientes) proviene de la etiqueta del fabricante; revisa siempre la etiqueta del envase que recibes. Los suplementos no sustituyen una alimentación variada ni el consejo de un profesional de la salud. Los productos con estimulantes, como la cafeína, no son aptos para menores de 18 años, embarazadas, mujeres en lactancia ni personas sensibles a estimulantes.</p>
    <h2>3. Precios</h2>
    <p>Los precios se expresan en dólares de los Estados Unidos. El precio y el costo de envío que valen son los que aparecen al confirmar el pedido: el sistema los vuelve a calcular en ese momento con las existencias y tarifas vigentes.</p>
    <h2>4. Cómo se forma el pedido</h2>
    <ol>
      <li>Eliges productos y completas tus datos de entrega. No necesitas crear una cuenta.</li>
      <li>Eliges la forma de pago: transferencia bancaria o, cuando se cumplen las condiciones de la <Link to="/legal/envios">política de envíos y pagos</Link>, contra entrega.</li>
      <li>Al confirmar, continúas tu compra por WhatsApp con el pedido en el mensaje; ahí te atendemos.</li>
      <li><b>Transferencia:</b> al confirmar registramos el pedido como pendiente de pago y reservamos sus productos durante {hours} horas. Te damos los datos de la cuenta, transfieres y nos envías el comprobante; registrar un pedido no significa que esté pagado. Si el pago no llega en ese plazo, el pedido se cancela automáticamente y los productos vuelven al catálogo. Validado el pago, preparamos y despachamos el pedido.</li>
      <li><b>Contra entrega:</b> confirmas el pedido por WhatsApp y nos envías tu ubicación dentro de {info?.cashOnDelivery.confirmHours ?? 4} horas; si no lo confirmas, se cancela automáticamente. Confirmado, lo preparamos y enviamos, y pagas el total al recibirlo.</li>
    </ol>
    <p>Puedes consultar el estado en <Link to="/pedido">Consulta tu pedido</Link> con el número de pedido y el correo o teléfono de la compra.</p>
    <h2>5. Cancelaciones</h2>
    <p>Puedes pedir la cancelación de un pedido antes de su despacho escribiéndonos por WhatsApp. Si ya transferiste, te devolvemos el importe pagado por transferencia bancaria.</p>
    <h2>6. Cambios y devoluciones</h2>
    <p>No aceptamos cambios ni devoluciones por preferencia; revisa sabor, tamaño y presentación antes de confirmar. Si enviamos un producto equivocado, dañado o vencido, lo corregimos según la <Link to="/legal/devoluciones">política de cambios y devoluciones</Link>.</p>
    <h2>7. Datos personales</h2>
    <p>Tratamos tus datos según la <Link to="/legal/privacidad">política de privacidad</Link>.</p>
    <h2>8. Ley aplicable</h2>
    <p>Estos términos se rigen por las leyes de la República del Ecuador. Como consumidor conservas todos los derechos que te reconoce la Ley Orgánica de Defensa del Consumidor.</p>
  </>;
}

function Privacy({ legal }: { legal?: StoreLegal }) {
  return <>
    <p>Esta política explica qué datos personales tratamos, para qué y cuáles son tus derechos según la Ley Orgánica de Protección de Datos Personales del Ecuador (LOPDP).</p>
    <h2>1. Responsable del tratamiento</h2>
    <Contact legal={legal} />
    <h2>2. Qué datos tratamos</h2>
    <ul>
      <li><b>Datos del pedido:</b> nombre completo, celular o WhatsApp, correo, provincia, ciudad, dirección y referencia de entrega, identificación para la factura (cédula, RUC o, si eres extranjero, pasaporte), productos, importes, notas y la referencia del comprobante si la escribes.</li>
      <li><b>Cuenta (opcional):</b> nombre, correo y contraseña cifrada si decides crear una cuenta.</li>
      <li><b>Datos técnicos:</b> dirección IP y registros de seguridad para prevenir abusos, como intentos repetidos de acceso o de pedidos.</li>
    </ul>
    <p>No pedimos datos de tarjetas ni claves bancarias: el pago es por transferencia desde tu banco.</p>
    <h2>3. Para qué los usamos y con qué base</h2>
    <ul>
      <li>Registrar, cobrar, preparar y entregar tu pedido, y comunicarnos contigo sobre él (ejecución del contrato de compra).</li>
      <li>Atender consultas y reclamos (ejecución del contrato y cumplimiento de obligaciones legales).</li>
      <li>Cumplir obligaciones contables y tributarias.</li>
      <li>Proteger la tienda contra fraudes y abusos (interés legítimo).</li>
    </ul>
    <p>No usamos tus datos para publicidad de terceros ni los vendemos.</p>
    <h2>4. Con quién los compartimos</h2>
    <ul>
      <li><b>Transportistas</b> (Servientrega o la mensajería de la entrega express): nombre, teléfono y dirección para entregar el pedido.</li>
      <li><b>Avisos internos del pedido:</b> enviamos al equipo de la tienda un resumen del pedido con tus datos de contacto y entrega por Telegram y, cuando está configurado, por correo electrónico.</li>
      <li><b>Proveedores de alojamiento y correo</b> que operan la tienda en la nube. Algunos de ellos pueden estar fuera del Ecuador (por ejemplo, en Estados Unidos); solo tratan los datos para prestar su servicio.</li>
      <li><b>Autoridades</b>, cuando la ley lo exija.</li>
    </ul>
    <h2>5. Cuánto tiempo los conservamos</h2>
    <p>Los datos del pedido se conservan mientras sean necesarios para la compra, la atención de reclamos y las obligaciones contables y tributarias. Los registros de seguridad y de auditoría (quién hizo cada cambio, desde qué conexión y con qué datos) se borran automáticamente a los 12 meses. Los avisos de pedido enviados se borran a los 30 días.</p>
    <h2>6. Qué se guarda en tu navegador</h2>
    <p>Para que la tienda funcione sin crear cuenta guardamos en tu propio navegador (almacenamiento local): el carrito durante 7 días, los productos vistos recientemente y el número de tu último pedido. No guardamos ahí tu nombre, teléfono, dirección ni datos de pago. Si inicias sesión, se guarda la sesión hasta que la cierres o caduque. No usamos cookies de publicidad ni de seguimiento de terceros.</p>
    <h2>7. Tus derechos</h2>
    <p>Puedes ejercer tus derechos de acceso, rectificación y actualización, eliminación, oposición, portabilidad y suspensión del tratamiento, así como a no ser objeto de decisiones basadas únicamente en tratamientos automatizados. Escríbenos por los medios de contacto indicados arriba; responderemos dentro de los plazos de la LOPDP. Si consideras que no atendimos tu solicitud, puedes acudir a la Superintendencia de Protección de Datos Personales.</p>
    <h2>8. Seguridad</h2>
    <p>Usamos conexión cifrada, contraseñas cifradas, permisos por rol para el personal, registro de auditoría de los cambios y límites contra intentos repetidos. Ningún sistema es infalible; si detectamos una vulneración que afecte tus datos, te informaremos conforme a la ley.</p>
  </>;
}

function Returns({ legal }: { legal?: StoreLegal }) {
  const whatsapp = legal?.whatsapp;
  return <>
    <h2>1. No aceptamos cambios ni devoluciones</h2>
    <p>Por tratarse de productos de consumo, <b>no aceptamos cambios ni devoluciones</b> por cambio de opinión, sabor, tamaño, presentación o preferencia personal. Antes de confirmar tu pedido revisa la presentación elegida, la porción y los ingredientes de la ficha; si tienes dudas, pregúntanos antes de comprar.</p>
    <h2>2. Si nos equivocamos: producto equivocado, dañado o vencido</h2>
    <p>Si recibes un producto distinto al que pediste, dañado en el transporte, con el sello alterado o vencido, no es un cambio por preferencia: es un error que corregimos. <b>Escríbenos apenas lo recibas</b>{whatsapp ? <> por <a href={whatsappHref(whatsapp, "Hola RawEnergy, recibí un producto con un problema en el pedido ")} target="_blank" rel="noopener noreferrer">WhatsApp</a></> : ""} con tu número de pedido y fotos del envase, la etiqueta y el lote.</p>
    <h2>3. Revisa tu pedido al recibirlo</h2>
    <p>Revisa el paquete y el sello de cada producto al recibirlo. Si notas algo extraño, fotografíalo antes de abrirlo.</p>
    <h2>4. Tus derechos</h2>
    <p>Esta política no limita los derechos irrenunciables que te reconoce la Ley Orgánica de Defensa del Consumidor.</p>
    <Contact legal={legal} />
  </>;
}

function Shipping({ legal, info }: { legal?: StoreLegal; info?: CheckoutInfo }) {
  const fee = (method: string) => info?.shippingRates.find(rate => rate.method === method)?.fee;
  const express = fee("EXPRESS_QUITO_VALLES"), national = fee("SERVIENTREGA_NATIONAL");
  const hours = legal?.reservationHours ?? info?.reservationHours ?? 24;
  return <>
    <h2>1. Pago</h2>
    <p>Al confirmar tu pedido continúas la compra por WhatsApp{legal?.whatsapp ? <> (<a href={whatsappHref(legal.whatsapp, "Hola RawEnergy, tengo una consulta sobre una compra.")} target="_blank" rel="noopener noreferrer">{formatWhatsapp(legal.whatsapp)}</a>)</> : ""}, con el detalle del pedido en el mensaje.</p>
    {info?.cashOnDelivery.enabled && <p><b>Contra entrega:</b> pagas al recibir el pedido, {cashOnDeliveryConditions(info)}. Debes confirmarlo por WhatsApp y enviarnos tu ubicación dentro de {info.cashOnDelivery.confirmHours} horas; si no, se cancela automáticamente.</p>}
    <p><b>Transferencia bancaria:</b> disponible en todas las compras. {info?.bank ? "Al confirmar tu pedido te mostramos los datos de la cuenta y el total a transferir;" : "Te damos los datos de la cuenta por WhatsApp al confirmar;"} usa tu número de pedido como referencia y envíanos el comprobante{legal?.whatsapp ? <> por <a href={whatsappHref(legal.whatsapp, "Hola RawEnergy, envío el comprobante del pedido ")} target="_blank" rel="noopener noreferrer">WhatsApp</a></> : ""}. No abrimos pasarelas de pago ni hacemos cobros automáticos.</p>
    <p>Si pagas por transferencia, reservamos tus productos durante <b>{hours} horas</b> desde que registras el pedido. Si el pago no llega en ese plazo, el pedido se cancela automáticamente.</p>
    <h2>2. Envíos</h2>
    <ul>
      {storePromises.slice(0, 2).map(promise => <li key={promise.title}><b>{promise.title}:</b> {promise.detail}</li>)}
      {express !== undefined && <li><b>Costo express Quito y Valles:</b> {formatMoney(express)}.</li>}
      {national !== undefined && <li><b>Costo nacional (Servientrega):</b> {formatMoney(national)}.</li>}
      {info && freeShippingText(info) && <li><b>{freeShippingText(info)}</b> (subtotal sin envío).</li>}
    </ul>
    <p>Con transferencia, los plazos se cuentan desde que validamos tu pago; con contra entrega, desde que confirmamos el pedido. El costo exacto se calcula antes de confirmar y depende de tu provincia: el envío express solo cubre Quito (con Cumbayá, Tumbaco y Conocoto) y Rumiñahui (Sangolquí).</p>
    <h2>3. Recepción</h2>
    <p>Revisa el paquete al recibirlo. No aceptamos cambios ni devoluciones por preferencia; si llega dañado, equivocado o con el sello alterado, consulta la <Link to="/legal/devoluciones">política de cambios y devoluciones</Link>.</p>
  </>;
}

export function LegalPage({ topic }: { topic: LegalTopic }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const title = legalTopics[topic];
  usePageEntry(title, heading);
  const { data } = useQuery<{ storeLegal: StoreLegal }>(STORE_LEGAL);
  const { data: checkout } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const legal = data?.storeLegal;
  const body: Record<LegalTopic, ReactNode> = {
    terminos: <Terms legal={legal} info={checkout?.checkoutInfo} />, privacidad: <Privacy legal={legal} />,
    devoluciones: <Returns legal={legal} />, envios: <Shipping legal={legal} info={checkout?.checkoutInfo} />
  };
  return (
    <div className="container legal-page">
      <nav className="breadcrumb" aria-label="Ruta de navegación"><ol><li><Link to="/">Inicio</Link></li><li aria-current="page">{title}</li></ol></nav>
      <div className="legal-layout">
        <nav className="legal-nav" aria-label="Información legal">
          <ul>{(Object.keys(legalTopics) as LegalTopic[]).map(key => <li key={key}><Link to={`/legal/${key}`} aria-current={key === topic ? "page" : undefined}>{legalTopics[key]}</Link></li>)}</ul>
        </nav>
        <article className="legal-body">
          <h1 ref={heading} tabIndex={-1}>{title}</h1>
          <p className="muted">Última actualización: {UPDATED}</p>
          {body[topic]}
        </article>
      </div>
    </div>
  );
}
