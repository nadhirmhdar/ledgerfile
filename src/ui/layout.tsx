import Link from "next/link";
import { useId, type ReactNode } from "react";

/** A white panel with a 1 px border. Header, body and an optional footer. */
export function Card({
  title,
  description,
  actions,
  footer,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border bg-surface shadow-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className="px-4 py-4 sm:px-5">{children}</div>}
      {footer && <div className="rounded-b-lg border-t border-border bg-surface-muted px-4 py-3 text-sm sm:px-5">{footer}</div>}
    </div>
  );
}

/** The top of a page: the one h1, a line of facts and status pills beneath it, one status sentence, and the page's actions. */
export function PageHeader({
  meta,
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  meta?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Earlier crumbs are links; one with no href is the page the reader is on, shown as text. */
  breadcrumb?: { label: string; href?: string }[];
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
              {breadcrumb.map((b, i) => (
                <li key={`${i}:${b.label}`} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true">/</span>}
                  {b.href ? (
                    <Link href={b.href} className="rounded-sm text-accent hover:underline">
                      {b.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-ink">
                      {b.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">{meta}</div>}
        {subtitle && <p className="mt-1 text-base text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled block on a page, with an optional line of explanation and actions. */
export function Section({
  title,
  description,
  actions,
  id,
  children,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  const heading = useId();
  return (
    <section id={id} aria-labelledby={heading} className={className}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={heading} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A flat list of records: a bold title, a muted second line, and a number or status on the right. */
export function ListRows({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={`divide-y divide-border rounded-lg border border-border bg-surface ${className}`}>{children}</ul>;
}

export function ListRow({ title, subtitle, meta, href, leading, inlineMeta = false }: { title: ReactNode; subtitle?: ReactNode; meta?: ReactNode; href?: string; leading?: ReactNode; /** Keep a small meta (an arrow, a count) beside the title on a phone instead of under it. */ inlineMeta?: boolean }) {
  return (
    <li className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-muted/60 sm:flex-nowrap">
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink">
          {href ? (
            <Link href={href} className="rounded-sm after:absolute after:inset-0 hover:text-accent hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </div>
        {subtitle && <div className="text-sm text-ink-muted">{subtitle}</div>}
      </div>
      {/* Below sm the meta drops under the title and may wrap, so a row of badges can never be wider than the screen; from sm up it sits at the right and does not shrink. */}
      {meta && <div className={`min-w-0 max-w-full text-sm text-ink tabular-nums sm:shrink-0 sm:basis-auto ${inlineMeta ? "shrink-0" : "basis-full max-sm:[&>*]:justify-start"}`}>{meta}</div>}
    </li>
  );
}

/** A figure with its label: for the small counts at the top of a page. */
export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <div className="text-sm text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-sm text-ink-muted">{hint}</div>}
    </>
  );
  const cls = "block rounded-lg border border-border bg-surface px-4 py-3 shadow-card";
  return href ? (
    <Link href={href} className={`${cls} hover:border-accent`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
