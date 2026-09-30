import { createContext, useCallback, useContext, useRef, useState, useEffect, type ReactNode } from "react";
type Options = { title: string; message: string; confirmLabel?: string; danger?: boolean };
const Context = createContext<(options: Options) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(Context);

/** Keep the active decision; a concurrent request is safely declined, never overwritten. */
export function createConfirmationManager(show: (options: Options | null) => void) {
  let resolve: ((value: boolean) => void) | undefined;
  return {
    request(options: Options): Promise<boolean> {
      if (resolve) return Promise.resolve(false);
      return new Promise(done => { resolve = done; show(options); });
    },
    finish(value: boolean) {
      const done = resolve;
      resolve = undefined;
      show(null);
      done?.(value);
    },
    cancel() {
      const done = resolve;
      resolve = undefined;
      done?.(false);
    },
  };
}
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<Options | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const manager = useRef<ReturnType<typeof createConfirmationManager> | null>(null);
  if (!manager.current) manager.current = createConfirmationManager(setOptions);
  const request = useCallback((next: Options) => manager.current!.request(next), []);
  useEffect(() => {
    if (options && !dialog.current?.open) dialog.current?.showModal();
    else if (!options && dialog.current?.open) dialog.current.close();
  }, [options]);
  useEffect(() => () => manager.current?.cancel(), []);
  const finish = (value: boolean) => manager.current!.finish(value);
  return <Context.Provider value={request}>{children}<dialog ref={dialog} className="confirm-dialog" aria-labelledby="confirm-title" onCancel={(event) => { event.preventDefault(); finish(false); }}><h2 id="confirm-title">{options?.title}</h2><p>{options?.message}</p><div className="dialog-actions"><button autoFocus onClick={() => finish(false)}>Cancelar</button><button className={options?.danger ? "danger-button" : "primary-button"} onClick={() => finish(true)}>{options?.confirmLabel ?? "Confirmar"}</button></div></dialog></Context.Provider>;
}
