import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
// Primary is the one solid fill. Secondary is white with a soft edge that firms up on hover. Ghost is a text button for low-weight actions.
const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent text-surface shadow-card hover:bg-accent-hover hover:border-accent-hover",
  secondary: "border-border-control bg-surface text-ink hover:border-border-strong hover:bg-surface-muted hover:text-accent",
  ghost: "border-transparent bg-transparent text-accent hover:bg-accent-soft",
  danger: "border-danger bg-surface text-danger-strong hover:bg-danger-soft",
};
// The default size is 40 px high. The small size is for a row of a table or list, and for an action repeated on every item; it is never the only way
// to do something important.
const SIZE: Record<ButtonSize, string> = {
  md: "min-h-10 px-4 text-sm",
  sm: "min-h-8 px-3 text-small",
};

/** The class list for a button look, for anything that is not a <button> (a link, a <summary>). */
export const buttonClass = (variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = ""): string =>
  `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${extra}`.trim();

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

/** A link that looks like a button. */
export function LinkButton({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}
