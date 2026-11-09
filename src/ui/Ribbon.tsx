import { createContext, useContext, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

/**
 * The ribbon (N5.2, Office look): the app's own groups (File, History) plus the groups of the screen that is open.
 * A screen puts its buttons there with <ScreenRibbon screen="bom">…</ScreenRibbon>; they stay in the screen's
 * component (same state, same handlers) and are only drawn in the ribbon.
 */
export type RibbonScreen = "pfd" | "operations" | "mb" | "bom" | "materials";
export const RibbonContext = createContext<{ el: HTMLElement | null; screen: RibbonScreen }>({ el: null, screen: "pfd" });

/** A screen's groups, drawn in the ribbon while that screen is open (nothing elsewhere). */
export function ScreenRibbon(props: { screen: RibbonScreen; children: ReactNode }) {
  const { el, screen } = useContext(RibbonContext);
  if (!el || screen !== props.screen) return null;
  return createPortal(props.children, el);
}

/** A named group of ribbon buttons (the name shows under it, as in Office). */
export function RibbonGroup(props: { label: string; children: ReactNode }) {
  return (
    <div className="rgroup" role="group" aria-label={props.label}>
      <div className="rgroup-body">{props.children}</div>
      <div className="rgroup-name" aria-hidden="true">{props.label}</div>
    </div>
  );
}

/** Small buttons stacked in one column (up to three, as in Office). */
export function RibbonStack(props: { children: ReactNode }) {
  return <div className="rstack">{props.children}</div>;
}

/** A ribbon button: big (icon over the label) or small (icon left of the label). Its name is its label. */
export function RibbonButton(props: { icon: IconName; label: ReactNode; big?: boolean; primary?: boolean; pressed?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const { icon, label, big, primary, pressed, className, ...rest } = props;
  return (
    <button type="button" {...rest} {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      className={`rbtn${big ? " big" : ""}${primary ? " primary" : ""}${pressed ? " on" : ""}${className ? ` ${className}` : ""}`}>
      <Icon name={icon} size={big ? 26 : 18} />
      <span className="rbtn-label">{label}</span>
    </button>
  );
}
