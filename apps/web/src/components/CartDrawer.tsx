import { ApolloError, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, MessageCircle, Minus, Plus, ShoppingBag, Tag, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkoutAttempt, findCheckoutAttempt, lineCap, CALCULATE_CART_TOTALS, CHECK_EMAIL, CHECKOUT_INFO, CREATE_CHECKOUT_ORDER, type CartTotals, type CheckoutInfo, type Order, useCartOrchestrator } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { ShippingProgress } from "./ShippingProgress";
import { Turnstile } from "./Turnstile";
import { catalogHref } from "../lib/catalogUrl";
import { friendlyError } from "../lib/errors";
import { cartSignature, recentSameOrder, rememberLastOrder } from "../lib/lastOrder";
import { hasSession, rememberGuestOrder } from "../lib/guestOrders";
import { ecuadorDateTime } from "../lib/orderStatus";
import { Link, navigate } from "../lib/router";
import { orderWhatsappMessage, whatsappHref } from "../lib/whatsapp";
import { ECUADOR, ID_TYPES, type IdType, cantonLabel, emailProblem, emailSuggestion, findProvince, identificationProblem, isExpressArea, mobileProblem, normalizeIdentification, normalizeMobile } from "../lib/ecuador";
import { useModalA11y } from "../lib/useModalA11y";
import { useSingleFlight } from "../lib/useSingleFlight";

type CheckoutForm = {
  fullName: string;
  email: string;
  phone: string;
  province: string;
  city: string;
  address: string;
  reference: string;
  idType: IdType;
  idNumber: string;
  shippingMethod: "EXPRESS_QUITO_VALLES" | "SERVIENTREGA_NATIONAL";
  paymentMethod: "BANK_TRANSFER" | "CASH_ON_DELIVERY";
  notes: string;
  paymentReference: string;
};

// Por qué se pide cada dato obligatorio cuando el cliente lo deja vacío.
// La validación es solo de la tienda (C57): el formulario lleva noValidate para que el navegador
// no muestre su burbuja encima de estos mensajes. Orden = orden visual, para enfocar el primer error.
const missingMessages: Record<string, string> = {
  fullName: "Escribe tu nombre completo para la entrega y la factura.",
  phone: "Escribe tu celular de 10 dígitos que empieza con 09; por ahí coordinamos tu pedido.",
  email: "Escribe tu correo, por ejemplo nombre@gmail.com.",
  province: "Elige tu provincia.",
  city: "Elige tu ciudad.",
  address: "Escribe la dirección exacta: calle principal, número y calle secundaria."
};
const fieldOrder = ["idNumber", "fullName", "phone", "email", "province", "city", "address"] as const;

const initialCheckout: CheckoutForm = {
  fullName: "",
  email: "",
  phone: "",
  province: "Pichincha",
  city: "Quito",
  address: "",
  reference: "",
  idType: "CEDULA",
  idNumber: "",
  shippingMethod: "EXPRESS_QUITO_VALLES",
  paymentMethod: "BANK_TRANSFER",
  notes: "",
  paymentReference: ""
};

export function CartDrawer() {
  const { items, isOpen, view, toggleCart, totals: localTotals, setQuantity, removeItem, consume, notice, itemCount } = useCartOrchestrator();
  const [step, setStep] = useState<"cart" | "checkout" | "success">("cart");
  const [form, setForm] = useState<CheckoutForm>(initialCheckout);
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const [copied, setCopied] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryInput, setRetryInput] = useState<unknown>(null);
  // Código de descuento (C46): el borrador que escribe y el que se envía al servidor.
  const [codeDraft, setCodeDraft] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [discountNotice, setDiscountNotice] = useState<string | null>(null);
  const discountNoticeRef = useRef<HTMLParagraphElement>(null);
  // Mismos productos que un pedido de hace menos de 30 min en este navegador (P02).
  const [repeatOf, setRepeatOf] = useState<string | null>(null);
  const repeatConfirmed = useRef(false);
  const repeatRef = useRef<HTMLDivElement>(null);
  const itemsSignature = cartSignature(items);
  useEffect(() => { setRepeatOf(null); repeatConfirmed.current = false; }, [itemsSignature]);
  const [createOrder, createState] = useMutation<{ createCheckoutOrder: Order }>(CREATE_CHECKOUT_ORDER);
  // Comprobación de persona (C70): solo si la API publica la clave de Turnstile. El token sirve una vez.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  // Que se le promete al cliente al terminar depende de si la tienda tiene
  // correo configurado: no se le puede decir que le llegara un correo si no.
  const { data: checkoutData } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const checkoutInfo = checkoutData?.checkoutInfo;
  const shippingLabel = (method: CheckoutForm["shippingMethod"]) => {
    const rate = checkoutInfo?.shippingRates.find(item => item.method === method);
    if (!rate || !checkoutInfo) return "se calcula al seleccionar";
    return checkoutInfo.freeShippingMethods.includes(method) && productsPaid >= checkoutInfo.freeShippingThreshold ? "gratis" : formatMoney(rate.fee);
  };

  const cartItemsInput = useMemo(
    () => items.map((item) => ({ productId: item.productId, variantSku: item.variantSku, quantity: item.quantity })),
    [items]
  );
  const totalsQuery = useQuery<{ calculateCartTotals: CartTotals }>(CALCULATE_CART_TOTALS, {
    variables: { cartItems: cartItemsInput, shippingMethod: form.shippingMethod, discountCode: discountCode || null },
    skip: step !== "checkout" || !items.length,
    fetchPolicy: "network-only"
  });
  const serverTotals = totalsQuery.data?.calculateCartTotals;
  // Solo se envía un código que el servidor aceptó para este carrito.
  const appliedCode = discountCode && serverTotals?.discountCode === discountCode ? discountCode : "";
  const codeRejected = discountCode && serverTotals && !serverTotals.discountCode ? serverTotals.discountMessage ?? "Ese código no aplica." : null;
  const applyCode = () => { const value = codeDraft.trim().toUpperCase(); setDiscountNotice(null); setDiscountCode(value); };
  const removeCode = () => { setDiscountCode(""); setCodeDraft(""); setDiscountNotice(null); requestAnimationFrame(() => document.getElementById("checkout-discount")?.focus()); };
  const checkoutInput = useMemo(() => ({
    customer: { fullName: form.fullName.trim(), email: form.email.trim(), phone: normalizeMobile(form.phone), province: form.province, city: form.city, address: form.address.trim(), reference: form.reference.trim(), idType: form.idType, idNumber: normalizeIdentification(form.idType, form.idNumber) },
    items: cartItemsInput,
    shippingMethod: form.shippingMethod, paymentMethod: form.paymentMethod, notes: form.notes.trim(), paymentReference: form.paymentMethod === "BANK_TRANSFER" && checkoutInfo?.bank ? form.paymentReference.trim() : "",
    ...(appliedCode ? { discountCode: appliedCode } : {})
  }), [form, cartItemsInput, appliedCode]);
  useEffect(() => {
    let active = true;
    void findCheckoutAttempt(checkoutInput).then(attempt => { if (active) setRetryInput(attempt ? checkoutInput : null); }).catch(() => { if (active) setRetryInput(null); });
    return () => { active = false; };
  }, [checkoutInput]);
  const canRetry = retryInput === checkoutInput;
  const totals = step === "checkout" ? serverTotals ?? localTotals : localTotals;
  // Lo que se paga por los productos: con código, el envío gratis y los mínimos se evalúan sobre esto.
  const productsPaid = Math.round((totals.subtotal - (totals.discount ?? 0)) * 100) / 100;
  const stockError = step === "checkout" ? totalsQuery.error : undefined;
  // El envio solo lo sabe el servidor. Mientras responde no mostramos "Gratis"
  // ni un total incompleto, y no dejamos crear la orden con cifras provisionales.
  const totalsReady = step !== "checkout" || (!!serverTotals && !totalsQuery.loading && !totalsQuery.error);

  const errorRef = useRef<HTMLDivElement>(null);
  const formError = submitError ?? stockError;

  // Misma regla que el servidor: express solo en los cantones Quito y Rumiñahui.
  const expressEligible = isExpressArea(form.province, form.city);
  const cantons = findProvince(form.province)?.cantons ?? [];
  const change = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => {
    setFieldErrors(current => ({ ...current, [key]: "", ...(key === "province" ? { city: "" } : {}) }));
    setForm(current => {
      const next = { ...current, [key]: value } as CheckoutForm;
      // Otra provincia: la ciudad anterior ya no aplica (si es Pichincha, se propone Quito).
      if (key === "province") next.city = value === "Pichincha" ? "Quito" : "";
      if ((key === "province" || key === "city") && !isExpressArea(next.province, next.city)) next.shippingMethod = "SERVIENTREGA_NATIONAL";
      return next;
    });
  };
  // Correo: formato y tipeo al instante; que el dominio reciba correo, al salir del campo.
  const [checkEmail] = useLazyQuery<{ checkEmail: { ok: boolean; message: string | null; suggestion: string | null } }>(CHECK_EMAIL, { fetchPolicy: "network-only" });
  const [emailHint, setEmailHint] = useState<{ email: string; suggestion: string | null; remote: string | null }>({ email: "", suggestion: null, remote: null });
  const reviewEmail = async () => {
    const email = form.email.trim();
    if (!email) return;
    const local = emailProblem(email);
    setEmailHint({ email, suggestion: emailSuggestion(email), remote: null });
    if (local) { setFieldErrors(current => ({ ...current, email: local })); return; }
    try {
      const { data } = await checkEmail({ variables: { email } });
      const result = data?.checkEmail;
      if (!result) return;
      setEmailHint(current => current.email === email ? { email, suggestion: result.suggestion ?? current.suggestion, remote: result.ok ? null : result.message } : current);
      if (!result.ok && result.message) setFieldErrors(current => ({ ...current, email: result.message! }));
    } catch { /* sin conexión: el servidor lo vuelve a revisar al confirmar */ }
  };
  const useSuggestion = (suggestion: string) => { change("email", suggestion); setEmailHint({ email: suggestion, suggestion: null, remote: null }); };
  // Verificador del documento al escribir: con los dígitos completos dice si es válido.
  const idComplete = form.idType !== "PASAPORTE" && normalizeIdentification(form.idType, form.idNumber).length === (form.idType === "RUC" ? 13 : 10);
  const idCheck = idComplete ? identificationProblem(form.idType, form.idNumber) : null;
  const fieldHelp = (name: keyof CheckoutForm) => ({ id: `checkout-${name}`, "aria-labelledby": `label-${name}`, "aria-invalid": !!fieldErrors[name], "aria-describedby": fieldErrors[name] ? `error-${name}` : ["province", "city"].includes(name) ? "address-help" : undefined });
  const fieldError = (name: keyof CheckoutForm) => fieldErrors[name] ? <small id={`error-${name}`} className="field-error">{fieldErrors[name]}</small> : null;
  const close = useCallback(() => {
    if (submittingRef.current) return;
    toggleCart(false);
    setStep((current) => (current === "success" ? "cart" : current));
  }, [toggleCart]);
  const { dialogRef, headingRef } = useModalA11y<HTMLElement, HTMLHeadingElement>(close, isOpen);

  // «Comprar ahora» abre directamente el paso de entrega.
  useEffect(() => {
    if (isOpen && view === "checkout" && items.length) setStep(current => current === "success" ? current : "checkout");
  }, [isOpen, view, items.length]);

  useEffect(() => {
    if (isOpen) headingRef.current?.focus();
  }, [isOpen, step, headingRef]);

  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);
  const [copyAccount] = useSingleFlight(async () => {
    try { await navigator.clipboard.writeText(checkoutInfo!.bank!.accountNumber); setCopied("Número de cuenta copiado."); }
    catch { setCopied("Selecciona el número de cuenta para copiarlo manualmente."); }
  }, 800);
  const [recheck, rechecking] = useSingleFlight(() => totalsQuery.refetch());
  const units = `${itemCount} ${itemCount === 1 ? "producto" : "productos"}`;
  const hours = checkoutInfo?.reservationHours ?? 24;
  const whatsapp = checkoutInfo?.whatsapp;
  // La tienda puede dar los datos de transferencia solo por WhatsApp (ajuste del panel).
  const bankOnWeb = Boolean(checkoutInfo?.bank);
  const onDelivery = createdOrder?.paymentMethod === "CASH_ON_DELIVERY";
  // Transferencia: plazo de pago. Contra entrega: plazo para confirmar por WhatsApp (C36).
  const confirmHours = checkoutInfo?.cashOnDelivery.confirmHours ?? 4;
  const deadline = createdOrder?.createdAt ? ecuadorDateTime(new Date(Date.parse(createdOrder.createdAt) + (onDelivery ? confirmHours : hours) * 3600000).toISOString()) : null;
  // Misma regla que aplica el servidor al crear el pedido; aquí solo explica y evita un rechazo.
  const cod = checkoutInfo?.cashOnDelivery;
  const codReason = !cod?.enabled ? "No disponible por ahora."
    : cod.expressOnly && form.shippingMethod !== "EXPRESS_QUITO_VALLES" ? "Solo con envío express en Quito y Valles."
    : cod.minimumSubtotal > 0 && productsPaid <= cod.minimumSubtotal ? `En compras de más de ${formatMoney(cod.minimumSubtotal)}.` : null;
  // Si deja de cumplir la regla (cambio de provincia, envío o cantidades), vuelve a transferencia.
  useEffect(() => {
    if (form.paymentMethod === "CASH_ON_DELIVERY" && codReason) setForm(current => ({ ...current, paymentMethod: "BANK_TRANSFER" }));
  }, [form.paymentMethod, codReason]);
  const explore = () => { close(); navigate(catalogHref()); };
  // Carrito vaciado durante la entrega (otra pestaña compró o lo vació): sin esto quedaba en
  // «Calculando…» sin «Confirmar» ni «Volver» (C63, V12).
  const [emptiedDuringCheckout, setEmptiedDuringCheckout] = useState(false);
  useEffect(() => {
    if (step === "checkout" && !items.length && !submittingRef.current) { setStep("cart"); setEmptiedDuringCheckout(true); }
    if (items.length) setEmptiedDuringCheckout(false);
  }, [step, items.length]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current || !items.length || (!totalsReady && !canRetry)) return;
    const errors: Record<string, string> = {};
    for (const [key, minimum] of [["fullName", 3], ["address", 8]] as const) if (form[key].trim().length < minimum) errors[key] = `Escribe al menos ${minimum} caracteres; los espacios solos no cuentan.`;
    const phoneIssue = mobileProblem(form.phone);
    if (phoneIssue) errors.phone = phoneIssue;
    const emailIssue = emailProblem(form.email) ?? (emailHint.email === form.email.trim() ? emailHint.remote : null);
    if (emailIssue) errors.email = emailIssue;
    if (!findProvince(form.province)) errors.province = "Elige tu provincia.";
    if (!form.city) errors.city = "Elige tu ciudad.";
    const idIssue = identificationProblem(form.idType, form.idNumber);
    if (idIssue) errors.idNumber = idIssue;
    // Un campo vacío recibe su mensaje propio en vez del de formato.
    for (const key of Object.keys(missingMessages) as (keyof CheckoutForm)[]) if (!String(form[key] ?? "").trim()) errors[key] = missingMessages[key]!;
    const first = fieldOrder.find(key => errors[key]);
    if (first) { setFieldErrors(errors); requestAnimationFrame(() => document.getElementById(`checkout-${first}`)?.focus()); return; }
    // Un reintento de la misma solicitud no crea otro pedido; uno nuevo con los mismos productos sí, así que se pregunta.
    const previous = !canRetry && !repeatConfirmed.current ? recentSameOrder(items) : null;
    if (previous) { setRepeatOf(previous); requestAnimationFrame(() => repeatRef.current?.focus()); return; }
    const captchaKey = checkoutInfo?.captchaSiteKey;
    if (captchaKey && !captchaToken && !captchaUnavailable && !canRetry) { setSubmitError(new Error("Estamos comprobando la conexión de forma segura. Vuelve a pulsar «Confirmar pedido» en unos segundos.")); return; }
    const purchasedItems = items.map(item => ({ ...item }));
    let submittedAttempt: Awaited<ReturnType<typeof checkoutAttempt>> | null = null;
    // Lock before awaiting the fingerprint: rapid clicks must share one request.
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
    const attempt = totalsReady ? await checkoutAttempt(checkoutInput, serverTotals?.total) : await findCheckoutAttempt(checkoutInput);
    submittedAttempt = attempt;
    if (!attempt || attempt.expectedTotal === undefined) throw new Error("Actualiza el total antes de crear un pedido nuevo.");
    setRetryInput(checkoutInput);
    const result = await createOrder({ variables: { input: { ...checkoutInput, expectedTotal: attempt.expectedTotal, idempotencyKey: attempt.key, ...(captchaToken ? { captchaToken } : {}) } } });
    const order = result.data?.createCheckoutOrder;
    if (!order) throw new Error("No se recibió la confirmación del pedido. Vuelve a intentarlo; se conservará la misma solicitud.");
    attempt.complete();
    setRetryInput(null);
    setCreatedOrder(order);
    rememberLastOrder(order.orderNumber, purchasedItems);
    // Sin sesión: se recuerda para enlazarlo a la cuenta si luego entra o se registra (C44).
    if (!hasSession()) rememberGuestOrder(order.orderNumber);
    repeatConfirmed.current = false; setRepeatOf(null);
    consume(purchasedItems);
    setStep("success");
    } catch (error) {
      if (error instanceof ApolloError && error.graphQLErrors.some(issue => issue.extensions?.code === "CART_TOTAL_CHANGED")) {
        submittedAttempt?.complete(); setRetryInput(null); void totalsQuery.refetch();
      }
      // El código es solo para la primera compra: se quita y se muestra el total sin descuento para confirmar de nuevo.
      const notEligible = error instanceof ApolloError ? error.graphQLErrors.find(issue => issue.extensions?.code === "DISCOUNT_NOT_ELIGIBLE") : undefined;
      if (notEligible) {
        submittedAttempt?.complete(); setRetryInput(null); setDiscountCode(""); setCodeDraft("");
        setDiscountNotice(notEligible.message); setSubmitError(null);
        requestAnimationFrame(() => discountNoticeRef.current?.focus());
        return;
      }
      const field = error instanceof ApolloError ? error.graphQLErrors.find(issue => issue.extensions?.field)?.extensions?.field as string | undefined : undefined;
      if (field && error instanceof ApolloError) {
        setFieldErrors(current => ({ ...current, [field]: error.graphQLErrors[0]?.message ?? "Revisa este dato." }));
        requestAnimationFrame(() => document.getElementById(`checkout-${field}`)?.focus());
      } else setSubmitError(error instanceof Error ? error : new Error("No se pudo crear el pedido. Tus datos se conservan para volver a intentarlo."));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      // Token de un solo uso: se pide otro para el próximo intento.
      if (captchaKey) setCaptchaReset(value => value + 1);
    }
  };

  return (
    <>
      <div className={`drawer-backdrop ${isOpen ? "is-visible" : ""}`} onClick={close} aria-hidden="true" />
      <aside
        ref={dialogRef}
        className={`cart-drawer step-${step} ${isOpen ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-heading"
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <header className="drawer-head">
          <h2 id="cart-drawer-heading" ref={headingRef} tabIndex={-1}>{step === "checkout" ? "Datos de entrega" : step === "success" ? "Pedido recibido" : <>Tu carrito <small>{units}</small></>}</h2>
          <button type="button" className="icon-btn" disabled={submitting} onClick={close} aria-label="Cerrar carrito"><X size={22} /></button>
        </header>

        <ol className="steps" aria-label="Progreso del pedido">
          {(["cart", "checkout", "success"] as const).map((name, index) => (
            <li key={name} className={step === name ? "is-current" : (["cart", "checkout", "success"].indexOf(step) > index ? "is-done" : "")} aria-current={step === name ? "step" : undefined}>
              <span aria-hidden="true">{index + 1}</span>{name === "cart" ? "Carrito" : name === "checkout" ? "Entrega" : "WhatsApp"}
            </li>
          ))}
        </ol>
        {step !== "success" && !!items.length && <ShippingProgress method={step === "checkout" ? form.shippingMethod : undefined} discount={step === "checkout" && appliedCode ? totals.discount : 0} />}
        {notice && step === "cart" && <p className="drawer-notice" role="status">{notice}</p>}

        {step === "cart" && (
          <div className="drawer-body">
            {!items.length && emptiedDuringCheckout && (
              <p className="notice" role="status">Tu carrito quedó vacío mientras completabas la entrega. Si hiciste el pedido en otra pestaña, revísalo en <Link to="/pedido" onClick={close}>Consulta tu pedido</Link>.</p>
            )}
            {!items.length && (
              <div className="empty-cart">
                <ShoppingBag size={40} aria-hidden="true" />
                <h3>Tu carrito está vacío</h3>
                <p>Explora el catálogo y agrega lo que necesitas para tu rutina.</p>
                <button type="button" className="btn btn-primary" onClick={explore}>Explorar productos</button>
              </div>
            )}
            <ul className="cart-lines">
              {items.map((item) => (
                <li className="cart-line" key={`${item.productId}:${item.variantSku}`}>
                  {item.image ? <img src={item.image} alt="" /> : <span className="cart-line-photo" />}
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.variantLabel}</small>
                    <b>{formatMoney(item.unitPrice * item.quantity)}{item.quantity > 1 && <small> · {formatMoney(item.unitPrice)} c/u</small>}</b>
                    <div className="stepper stepper-sm" role="group" aria-label={`Cantidad de ${item.title}`}>
                      <button type="button" onClick={() => setQuantity(item.variantSku, item.quantity - 1, item.productId)} aria-label={item.quantity === 1 ? `Quitar ${item.title}, ${item.variantLabel}` : `Disminuir cantidad de ${item.title}, ${item.variantLabel}`}><Minus size={14} /></button>
                      <output>{item.quantity}</output>
                      <button type="button" onClick={() => setQuantity(item.variantSku, item.quantity + 1, item.productId)} disabled={item.quantity >= lineCap(item)} aria-label={`Aumentar cantidad de ${item.title}, ${item.variantLabel}`}><Plus size={14} /></button>
                    </div>
                  </div>
                  <button type="button" className="icon-btn cart-line-remove" onClick={() => removeItem(item.variantSku, item.productId)} aria-label={`Quitar ${item.title}, ${item.variantLabel} del carrito`}><Trash2 size={18} /></button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === "checkout" && (
          <form className="drawer-body checkout-form" id="checkout-form" onSubmit={submit} noValidate>
            <p className="muted">Compra sin crear una cuenta. Al confirmar, terminas tu compra por WhatsApp con nuestro equipo{bankOnWeb ? "" : ": ahí te damos los datos para pagar"}.</p>
            <div className="order-summary">
              <div><span>{units}</span><span>{formatMoney(totals.subtotal)}</span></div>
              {totalsReady && appliedCode && totals.discount > 0 && <div className="summary-discount"><span>Descuento {appliedCode} ({serverTotals?.discountPercent} %)</span><span>−{formatMoney(totals.discount)}</span></div>}
              <div><span>Envío</span><span>{!totalsReady ? "Calculando…" : totals.shippingFee > 0 ? formatMoney(totals.shippingFee) : "Gratis"}</span></div>
              <div className="order-summary-total checkout-summary-total"><b>Total</b><strong>{totalsReady ? formatMoney(totals.total) : "Calculando…"}</strong></div>
            </div>
            <div className="discount-box">
              {appliedCode ? (
                <p className="discount-applied" role="status"><Tag size={18} aria-hidden="true" /><span>Código <b>{appliedCode}</b> aplicado. {serverTotals?.discountMessage}</span><button type="button" className="btn-link" onClick={removeCode}>Quitar</button></p>
              ) : (
                <>
                  <label className="field" htmlFor="checkout-discount">Código de descuento <small className="field-help">(opcional)</small></label>
                  {/* El código anunciado se ofrece como botón: como texto de ejemplo parecía ya escrito (C63, V23). */}
                  {checkoutInfo?.welcomeDiscount?.code && !discountCode && <button type="button" className="btn btn-outline btn-sm discount-suggest" disabled={totalsQuery.loading} onClick={() => { const code = checkoutInfo.welcomeDiscount!.code!; setCodeDraft(code); setDiscountNotice(null); setDiscountCode(code); }}><Tag size={16} aria-hidden="true" /> Usar {checkoutInfo.welcomeDiscount.code} ({checkoutInfo.welcomeDiscount.percent} % en tu primera compra)</button>}
                  <div className="discount-row">
                    <input id="checkout-discount" value={codeDraft} onChange={event => setCodeDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyCode(); } }} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={30} placeholder="Escribe tu código" aria-invalid={codeRejected ? true : undefined} aria-describedby={codeRejected || discountNotice ? "discount-message" : undefined} />
                    <button type="button" className="btn btn-outline" disabled={!codeDraft.trim() || totalsQuery.loading} onClick={applyCode}>Aplicar</button>
                  </div>
                  {(codeRejected || discountNotice) && <p id="discount-message" className="field-error" role="alert" tabIndex={-1} ref={discountNoticeRef}>{discountNotice ?? codeRejected}</p>}
                </>
              )}
            </div>
            <fieldset className="plain-fieldset" disabled={submitting}>
              <div className="form-grid">
                <label className="field"><span id="label-idType">Documento (factura)</span><select {...fieldHelp("idType")} name="idType" value={form.idType} onChange={(event) => { change("idType", event.target.value as IdType); setFieldErrors(current => ({ ...current, idNumber: "" })); }}>
                  {ID_TYPES.map(([value, label]) => <option key={value} value={value}>{label}{value === "PASAPORTE" ? " (extranjeros)" : ""}</option>)}
                </select></label>
                <label className="field"><span id="label-idNumber">{form.idType === "PASAPORTE" ? "Número de pasaporte" : form.idType === "RUC" ? "Número de RUC" : "Número de cédula"}</span><input {...fieldHelp("idNumber")} name="idNumber" inputMode={form.idType === "PASAPORTE" ? "text" : "numeric"} autoComplete="off" autoCapitalize="characters" maxLength={form.idType === "PASAPORTE" ? 20 : form.idType === "RUC" ? 13 : 10} value={form.idNumber} onChange={(event) => change("idNumber", form.idType === "PASAPORTE" ? event.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, "") : event.target.value.replace(/\D/g, ""))} onBlur={() => { const issue = form.idNumber ? identificationProblem(form.idType, form.idNumber) : null; if (issue) setFieldErrors(current => ({ ...current, idNumber: issue })); }} required />{fieldError("idNumber") ?? (idComplete && (idCheck ? <small className="field-error" role="status">{idCheck}</small> : <small className="field-ok" role="status"><CheckCircle2 size={14} aria-hidden="true" /> {form.idType === "RUC" ? "RUC válido" : "Cédula válida"}</small>))}</label>
                <label className="field"><span id="label-fullName">Nombre completo</span><input {...fieldHelp("fullName")} name="fullName" autoComplete="name" minLength={3} maxLength={100} value={form.fullName} onChange={(event) => change("fullName", event.target.value)} required />{fieldError("fullName")}</label>
                <label className="field"><span id="label-phone">Celular (WhatsApp)</span><input {...fieldHelp("phone")} name="phone" type="tel" inputMode="tel" autoComplete="tel-national" maxLength={17} placeholder="0991234567" value={form.phone} onChange={(event) => change("phone", event.target.value.replace(/[^\d+ -]/g, ""))} onBlur={() => { const normalized = normalizeMobile(form.phone); if (!mobileProblem(normalized)) change("phone", normalized); else if (form.phone) setFieldErrors(current => ({ ...current, phone: mobileProblem(form.phone)! })); }} required />{fieldError("phone")}</label>
                <label className="field full"><span id="label-email">Correo</span><input type="email" {...fieldHelp("email")} name="email" autoComplete="email" inputMode="email" maxLength={120} placeholder="nombre@gmail.com" value={form.email} onChange={(event) => change("email", event.target.value.trim())} onBlur={() => void reviewEmail()} required />{fieldError("email")}
                  {emailHint.suggestion && emailHint.email === form.email.trim() && <span className="email-suggestion">¿Quisiste decir <b>{emailHint.suggestion}</b>? <button type="button" className="btn-link" onClick={() => useSuggestion(emailHint.suggestion!)}>Usar este correo</button></span>}
                </label>
                <label className="field"><span id="label-province">Provincia</span><select {...fieldHelp("province")} name="province" autoComplete="address-level1" value={form.province} onChange={(event) => change("province", event.target.value)} required>
                  <option value="" disabled>Elige tu provincia</option>
                  {ECUADOR.map(entry => <option key={entry.province} value={entry.province}>{entry.province}</option>)}
                </select>{fieldError("province")}</label>
                <label className="field"><span id="label-city">Ciudad (cantón)</span><select {...fieldHelp("city")} name="city" autoComplete="address-level2" value={form.city} disabled={!cantons.length} onChange={(event) => change("city", event.target.value)} required>
                  <option value="" disabled>{cantons.length ? "Elige tu ciudad" : "Primero elige la provincia"}</option>
                  {cantons.map(canton => <option key={canton[0]} value={canton[0]}>{cantonLabel(canton)}</option>)}
                </select>{fieldError("city")}</label>
                <label className="field full"><span id="label-address">Dirección exacta</span><input {...fieldHelp("address")} name="address" autoComplete="street-address" minLength={8} maxLength={240} value={form.address} onChange={(event) => change("address", event.target.value)} placeholder="Calle principal, número y calle secundaria" required />{fieldError("address")}</label>
                <label className="field full"><span id="label-reference">Referencia (opcional)</span><input {...fieldHelp("reference")} name="reference" maxLength={180} value={form.reference} onChange={(event) => change("reference", event.target.value)} placeholder="Casa, edificio, local, horarios" />{fieldError("reference")}</label>
              </div>
              <p id="address-help" className="field-help">El envío express cubre Quito (con Cumbayá, Tumbaco y Conocoto) y Rumiñahui (Sangolquí). Para el resto del país enviamos por Servientrega.</p>
              <fieldset className="delivery-options">
                <legend>Entrega</legend>
                <label className="choice"><input type="radio" name="shippingMethod" disabled={!expressEligible} checked={form.shippingMethod === "EXPRESS_QUITO_VALLES"} onChange={() => change("shippingMethod", "EXPRESS_QUITO_VALLES")} /><span><b>Express Quito y Valles</b><small>{expressEligible ? <>{shippingLabel("EXPRESS_QUITO_VALLES")}{checkoutInfo?.freeShippingMethods.includes("EXPRESS_QUITO_VALLES") && shippingLabel("EXPRESS_QUITO_VALLES") !== "gratis" ? ` · gratis desde ${formatMoney(checkoutInfo.freeShippingThreshold)}` : ""}</> : "Solo en Quito y Rumiñahui (Sangolquí)"}</small></span></label>
                <label className="choice"><input type="radio" name="shippingMethod" checked={form.shippingMethod === "SERVIENTREGA_NATIONAL"} onChange={() => change("shippingMethod", "SERVIENTREGA_NATIONAL")} /><span><b>Nacional · Servientrega</b><small>{shippingLabel("SERVIENTREGA_NATIONAL")}</small></span></label>
              </fieldset>
              <fieldset className="delivery-options payment-options">
                <legend>Forma de pago</legend>
                <label className="choice"><input type="radio" name="paymentMethod" checked={form.paymentMethod === "BANK_TRANSFER"} onChange={() => change("paymentMethod", "BANK_TRANSFER")} /><span><b>Transferencia bancaria</b><small>{bankOnWeb ? `Al confirmar ves los datos de la cuenta y envías el comprobante${whatsapp ? " por WhatsApp" : ""}.` : "Te damos los datos de la cuenta por WhatsApp al confirmar."}</small></span></label>
                {cod?.enabled && <label className="choice"><input type="radio" name="paymentMethod" disabled={!!codReason} checked={form.paymentMethod === "CASH_ON_DELIVERY"} onChange={() => change("paymentMethod", "CASH_ON_DELIVERY")} /><span><b>Contra entrega</b><small>{codReason ?? "Pagas al recibir; confirmas el pedido por WhatsApp."}</small></span></label>}
              </fieldset>
              {form.paymentMethod === "BANK_TRANSFER" ? (
                <div className="payment-box">
                  <p>{bankOnWeb ? "Despachamos cuando validamos el pago. No se abre una pasarela ni se cobra automáticamente." : "Al confirmar te llevamos a WhatsApp con tu pedido; ahí recibes los datos para transferir. Despachamos cuando validamos el pago."}</p>
                  <p className="reserve-note"><Clock3 size={16} aria-hidden="true" /><span>Reservamos tus productos durante {hours} horas. Si el pago no llega en ese plazo, el pedido se cancela automáticamente.</span></p>
                  {bankOnWeb && <label className="field"><span>Número de comprobante (opcional)</span><input name="paymentReference" maxLength={120} value={form.paymentReference} onChange={(event) => change("paymentReference", event.target.value)} placeholder="Si ya transferiste, escribe la referencia" /></label>}
                </div>
              ) : (
                <div className="payment-box">
                  <p>Pagas el total al recibir el pedido. Al confirmar te llevamos a WhatsApp: ahí confirmas el pedido y nos envías tu ubicación.</p>
                  <p className="reserve-note"><Clock3 size={16} aria-hidden="true" /><span>Si no lo confirmas por WhatsApp en {confirmHours} horas, el pedido se cancela automáticamente.</span></p>
                </div>
              )}
              <label className="field"><span>Notas del pedido (opcional)</span><textarea name="notes" value={form.notes} onChange={(event) => change("notes", event.target.value)} maxLength={320} placeholder="Horario de entrega, instrucciones especiales…" /></label>
            </fieldset>
            {totalsQuery.error && <button type="button" className="btn btn-outline btn-block" disabled={rechecking} onClick={() => void recheck()}>{rechecking ? "Comprobando…" : "Volver a comprobar existencias y envío"}</button>}
            {repeatOf && (
              <div className="notice repeat-order" role="alert" tabIndex={-1} ref={repeatRef}>
                <span>Hace menos de 30 minutos registraste el pedido <b>{repeatOf}</b> con estos mismos productos. ¿Quieres hacer otro pedido igual?</span>
                <span className="repeat-actions">
                  <Link to={`/pedido?numero=${encodeURIComponent(repeatOf)}`} onClick={close}>Ver ese pedido</Link>
                  <button type="button" className="btn btn-outline" onClick={() => { repeatConfirmed.current = true; setRepeatOf(null); (document.getElementById("checkout-form") as HTMLFormElement | null)?.requestSubmit(); }}>Sí, hacer otro pedido</button>
                </span>
              </div>
            )}
            {formError && <div className="notice notice-error checkout-error" role="alert" tabIndex={-1} ref={errorRef}>{friendlyError(formError, "No se pudo crear el pedido. Tus datos se conservan para volver a intentarlo.")}</div>}
            {canRetry && <p className="notice">Hay una solicitud sin confirmar con estos datos. Reintentar recupera el mismo pedido si ya se registró.</p>}
            {checkoutInfo?.captchaSiteKey && <Turnstile siteKey={checkoutInfo.captchaSiteKey} resetKey={captchaReset} onToken={setCaptchaToken} onUnavailable={() => setCaptchaUnavailable(true)} />}
            {captchaUnavailable && <p className="field-help" role="status">No se pudo cargar la verificación de seguridad. Si tienes un bloqueador de anuncios, permítelo en esta tienda y recarga la página.</p>}
            {whatsapp && <p className="field-help whatsapp-next"><MessageCircle size={16} aria-hidden="true" /> Después de confirmar, continúas por WhatsApp con tu pedido listo para enviar.</p>}
            <p className="field-help legal-accept">No aceptamos cambios ni devoluciones por preferencia: revisa sabor y tamaño antes de confirmar. Al confirmar aceptas los <a href="/legal/terminos" target="_blank" rel="noopener">términos y condiciones</a>, la <a href="/legal/devoluciones" target="_blank" rel="noopener">política de cambios</a> y la <a href="/legal/privacidad" target="_blank" rel="noopener">política de privacidad</a>.</p>
          </form>
        )}

        {step === "success" && createdOrder && (
          <div className="drawer-body order-success">
            <CheckCircle2 size={40} aria-hidden="true" />
            <p className="eyebrow">Pedido {createdOrder.orderNumber}</p>
            <h3>{whatsapp ? onDelivery ? "Pedido registrado. Confírmalo por WhatsApp y envíanos tu ubicación." : `Pedido registrado. Continúa por WhatsApp para ${bankOnWeb ? "enviar tu comprobante" : "recibir los datos de pago"}.` : onDelivery ? "Tu pedido está registrado. Pagas al recibirlo." : "Tu pedido está registrado y pendiente de pago."}</h3>
            {whatsapp && (
              <a className="btn btn-primary btn-block btn-lg whatsapp-continue" target="_blank" rel="noopener noreferrer" href={whatsappHref(whatsapp, orderWhatsappMessage(createdOrder, { bankShown: bankOnWeb }))}>
                <MessageCircle size={20} aria-hidden="true" /> {onDelivery ? "Confirmar mi pedido por WhatsApp" : "Continuar mi compra por WhatsApp"}
              </a>
            )}
            <p>{whatsapp
              ? `El mensaje ya incluye tu pedido, la entrega y la forma de pago; solo tienes que enviarlo.${onDelivery ? " Después compártenos tu ubicación en el chat. Pagas el total al recibir." : bankOnWeb ? "" : " Te respondemos con los datos para transferir."}`
              : onDelivery ? "Te contactaremos para coordinar la entrega en tu dirección." : bankOnWeb ? "Transfiere el total a esta cuenta usando tu número de pedido como referencia y envíanos el comprobante." : "Te contactaremos con los datos para transferir."}
              {checkoutInfo?.notifiesByEmail ? ` También te enviamos la confirmación a ${createdOrder.customer.email}.` : ""}</p>
            {deadline && <p className="notice reserve-note"><Clock3 size={18} aria-hidden="true" /><span>{onDelivery ? <>Confírmalo por WhatsApp antes del <b>{deadline}</b>; si no, el pedido se cancela automáticamente.</> : <>Paga antes del <b>{deadline}</b>; después, el pedido se cancela automáticamente y los productos vuelven al catálogo.</>}</span></p>}
            {!onDelivery && checkoutInfo?.bank && <section className="bank-instructions" aria-labelledby="bank-title">
              <h4 id="bank-title">Datos para la transferencia</h4>
              <dl><dt>Banco</dt><dd>{checkoutInfo.bank.name}</dd><dt>Tipo de cuenta</dt><dd>{checkoutInfo.bank.accountType || "Consulta con la tienda"}</dd><dt>Cuenta</dt><dd>{checkoutInfo.bank.accountNumber}</dd><dt>Titular</dt><dd>{checkoutInfo.bank.holder}</dd><dt>Referencia del pedido</dt><dd>{createdOrder.orderNumber}</dd></dl>
              <button type="button" className="btn btn-outline btn-block" onClick={() => void copyAccount()}>Copiar número de cuenta</button><p role="status" className="field-help">{copied}</p>
            </section>}
            <div className="order-summary">
              {createdOrder.items.map(item => <div key={`${item.productId}:${item.variantSku}`}><span>{item.quantity} × {item.title} <small>{item.variantLabel}</small></span><span>{formatMoney(item.lineTotal)}</span></div>)}
              {createdOrder.discount && <div className="summary-discount"><span>Descuento {createdOrder.discount.code} ({createdOrder.discount.percent} %)</span><span>−{formatMoney(createdOrder.discount.amount)}</span></div>}
              <div><span>Envío</span><span>{createdOrder.shippingFee > 0 ? formatMoney(createdOrder.shippingFee) : "Gratis"}</span></div>
              <div className="order-summary-total"><b>{onDelivery ? "Total a pagar al recibir" : "Total a transferir"}</b><strong>{formatMoney(createdOrder.total)}</strong></div>
            </div>
            <p className="field-help">Consulta el estado cuando quieras en <Link to={`/pedido?numero=${encodeURIComponent(createdOrder.orderNumber)}`} onClick={close}>Consulta tu pedido</Link> con este número y tu correo o celular.</p>
            <button type="button" className={`btn ${whatsapp ? "btn-outline" : "btn-primary"} btn-block btn-lg`} onClick={close}>Seguir comprando</button>
          </div>
        )}

        {!!items.length && step === "cart" && (
          <footer className="drawer-foot">
            <div className="total-line"><span>Subtotal</span><strong>{formatMoney(totals.subtotal)}</strong></div>
            <small>El envío se calcula en el siguiente paso. No necesitas crear una cuenta.</small>
            {checkoutInfo?.welcomeDiscount && <p className="welcome-hint"><Tag size={16} aria-hidden="true" />{checkoutInfo.welcomeDiscount.code ? <span>¿Primera compra? Usa el código <b>{checkoutInfo.welcomeDiscount.code}</b> en el siguiente paso: {checkoutInfo.welcomeDiscount.percent} % de descuento.</span> : <span>¿Tienes un código de descuento? Lo aplicas en el siguiente paso.</span>}</p>}
            <button type="button" className="btn btn-primary btn-block btn-lg checkout" onClick={() => setStep("checkout")}>Continuar con la entrega <ArrowRight size={18} aria-hidden="true" /></button>
          </footer>
        )}

        {!!items.length && step === "checkout" && (
          <footer className="drawer-foot drawer-foot-split">
            <button type="button" className="btn btn-outline btn-lg checkout-back" disabled={submitting} onClick={() => setStep("cart")} aria-label="Volver al carrito"><ArrowLeft size={18} aria-hidden="true" /><span className="back-label">Volver</span></button>
            <button className="btn btn-primary btn-lg checkout" type="submit" form="checkout-form" disabled={submitting || createState.loading || (!totalsReady && !canRetry)}>{submitting ? "Confirmando…" : canRetry ? "Reintentar confirmación" : !totalsReady ? "Calculando total…" : <>Confirmar pedido<span className="btn-total"> · {formatMoney(totals.total)}</span></>}</button>
          </footer>
        )}
      </aside>
    </>
  );
}
