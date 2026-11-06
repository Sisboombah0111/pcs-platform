import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

export function Dialog(props: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // The cursor goes to the first field to fill in (or a field marked data-autofocus); without fields, to the main button.
    const root = ref.current;
    const target = root?.querySelector<HTMLElement>("[data-autofocus]")
      ?? root?.querySelector<HTMLElement>(".body input:not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]), .body textarea:not([disabled])")
      ?? root?.querySelector<HTMLElement>(".foot .btn.primary:not([disabled]), .foot .btn");
    target?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); props.onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Enter in a one-line field = the main button (unless the field used Enter itself, e.g. to leave the field). */
  const enterSubmits = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.nativeEvent.isComposing) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !["text", "number", "search", "email", "tel", "url", ""].includes(t.type)) return;
    setTimeout(() => {
      if (document.activeElement !== t || !t.isConnected) return;
      const main = ref.current?.querySelector<HTMLButtonElement>(".foot .btn.primary");
      if (main && !main.disabled) main.click();
    }, 0);
  };
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className={`dialog${props.wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={props.title} ref={ref} onKeyDown={enterSubmits}>
        <h2>{props.title}</h2>
        <div className="body">{props.children}</div>
        <div className="foot">{props.actions}</div>
      </div>
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** In-page confirmation (window.confirm is unavailable in some embeds). */
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })), []);
  const close = (ok: boolean) => { state?.resolve(ok); setState(null); };
  const element = state ? (
    <Dialog
      title={state.title}
      onClose={() => close(false)}
      actions={<>
        <button className="btn" onClick={() => close(false)}>{state.cancelLabel ?? "Cancel"}</button>
        <button className={`btn primary${state.danger ? " danger" : ""}`} onClick={() => close(true)}>{state.confirmLabel}</button>
      </>}
    >
      {typeof state.body === "string" ? <p>{state.body}</p> : state.body}
    </Dialog>
  ) : null;
  return { confirm, element };
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string) => {
    setMsg(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);
  const element = msg ? <div className="toast" role="status">{msg}</div> : null;
  return { show, element };
}
