import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ejecuta la acción una sola vez aunque se pulse repetidamente: los clics que
 * llegan mientras corre (y durante `cooldownMs` después) se ignoran. El bloqueo
 * es síncrono con una ref, así que dos clics en el mismo fotograma no pasan.
 */
export function useSingleFlight<Args extends unknown[]>(action: (...args: Args) => unknown, cooldownMs = 0) {
  const locked = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { mounted.current = false; }, []);
  const run = useCallback(async (...args: Args) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await action(...args);
    } finally {
      const release = () => { locked.current = false; if (mounted.current) setBusy(false); };
      if (cooldownMs > 0) window.setTimeout(release, cooldownMs); else release();
    }
  }, [action, cooldownMs]);
  return [run, busy] as const;
}
