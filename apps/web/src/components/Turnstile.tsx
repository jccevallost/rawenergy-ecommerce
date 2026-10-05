import { useEffect, useRef } from "react";

// Cloudflare Turnstile (C70): comprueba en segundo plano que quien registra o compra es una
// persona. Solo se carga si la API anuncia la clave pública (checkoutInfo.captchaSiteKey).
type TurnstileApi = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: TurnstileApi } }

let loader: Promise<void> | null = null;
const load = () => loader ??= new Promise<void>((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.onload = () => resolve();
  script.onerror = () => { loader = null; reject(new Error("No se pudo cargar la verificación")); };
  document.head.appendChild(script);
});

/** `resetKey` cambia para pedir un token nuevo (los tokens sirven una sola vez). */
export function Turnstile({ siteKey, resetKey, onToken, onUnavailable }: { siteKey: string; resetKey: number; onToken: (token: string | null) => void; onUnavailable: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onToken, onUnavailable });
  callbacks.current = { onToken, onUnavailable };
  useEffect(() => {
    let id: string | undefined;
    let cancelled = false;
    callbacks.current.onToken(null);
    load().then(() => {
      if (cancelled || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: siteKey, language: "es", appearance: "interaction-only",
        callback: (token: string) => callbacks.current.onToken(token),
        "expired-callback": () => callbacks.current.onToken(null),
        "error-callback": () => callbacks.current.onUnavailable()
      });
    }).catch(() => callbacks.current.onUnavailable());
    return () => { cancelled = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey, resetKey]);
  return <div ref={box} className="turnstile-box" />;
}
