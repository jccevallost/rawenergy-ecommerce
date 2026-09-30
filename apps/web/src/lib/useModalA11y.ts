import { useEffect, useRef } from "react";
import { useModalLayer } from "./modalLayers";

const FOCUSABLE_SELECTOR = 'summary, a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Comportamiento común de los diálogos: foco inicial en el encabezado, Tab
 * limitado a los controles visibles del diálogo, Escape para cerrar y registro
 * como capa modal para que App vuelva inerte el fondo. El regreso
 * del foco al control que abrió el diálogo lo hace App, porque el fondo se vuelve
 * `inert` y el navegador pierde el elemento activo antes de que corra este efecto.
 */
export function useModalA11y<Dialog extends HTMLElement = HTMLElement, Heading extends HTMLElement = HTMLElement>(onClose: () => void, active = true, { inertBackground = true } = {}) {
  // Un diálogo renderizado dentro de la tienda (p. ej. la hoja de filtros) no puede
  // volverla inerte sin bloquearse a sí mismo: lo indica con inertBackground false.
  useModalLayer(active && inertBackground);
  const dialogRef = useRef<Dialog>(null);
  const headingRef = useRef<Heading>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (active) headingRef.current?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === headingRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  return { dialogRef, headingRef };
}
