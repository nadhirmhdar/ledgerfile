import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent text-surface hover:bg-accent-hover hover:border-accent-hover",
  secondary: "border-border-strong bg-surface text-ink hover:bg-surface-muted",
  ghost: "border-transparent bg-transparent text-accent hover:bg-accent-soft",
  danger: "border-danger bg-surface text-danger-strong hover:bg-danger-soft",
};
// Primary controls are at least 40 px high; the small size is for dense rows and is never the only way to do something important.
const SIZE: Record<ButtonSize, string> = {
  md: "min-h-10 px-4 text-sm",
  sm: "min-h-8 px-3 text-sm",
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
