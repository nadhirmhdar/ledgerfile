import Link from "next/link";
import { useId, type ReactNode } from "react";
import { ChevronLeftIcon } from "./icons";

/**
 * A white panel with a hairline edge. Header, body and an optional footer. `raised` is for the ONE card on a page that is the main thing (the next
 * step, a preview, a confirmation): a lift in shadow and a cobalt-tinted edge, not a heavier border.
 */
export function Card({
  title,
  description,
  actions,
  footer,
  children,
  className = "",
  raised = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  raised?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-surface ${raised ? "border-accent-edge shadow-raised" : "border-border shadow-card"} ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
          <div>
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className="px-4 py-4 sm:px-6 sm:py-5">{children}</div>}
      {footer && <div className="rounded-b-lg border-t border-border bg-surface-muted px-4 py-3 text-sm sm:px-6">{footer}</div>}
    </div>
  );
}

/**
 * The top of a page, and the one bold element on it: a back link with a chevron, the title, the page's facts in a row (the client, the period and
 * status chips), one status sentence, and the page's actions at the right of the title (under it on a narrow screen). A hairline closes it, so the
 * content below starts clearly apart. A dot between two facts is dropped: the gap is the separator.
 */
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
  const parents = (breadcrumb ?? []).filter((b) => b.href);
  const here = (breadcrumb ?? []).filter((b) => !b.href);
  return (
    <header className="border-b border-border pb-6">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-ink-muted">
            {parents.map((b, i) => (
              <li key={`${i}:${b.label}`} className="flex items-center gap-1">
                {i === 0 && <ChevronLeftIcon className="size-4" />}
                {i > 0 && <span aria-hidden="true">/</span>}
                <Link href={b.href!} className="rounded-sm text-accent transition-colors hover:underline">
                  {b.label}
                </Link>
              </li>
            ))}
            {here.map((b, i) => (
              <li key={`here:${i}`} className="flex items-center gap-1">
                <span aria-hidden="true">/</span>
                <span aria-current="page" className="text-ink">
                  {b.label}
                </span>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-muted [&>[aria-hidden=true]]:hidden">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {subtitle && <p className="mt-3 text-base text-ink">{subtitle}</p>}
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
          {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A flat list of records: a title, a muted second line, and a number or status on the right. */
export function ListRows({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={`divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-card ${className}`}>{children}</ul>;
}

export function ListRow({ title, subtitle, meta, href, leading, inlineMeta = false }: { title: ReactNode; subtitle?: ReactNode; meta?: ReactNode; href?: string; leading?: ReactNode; /** Keep a small meta (an arrow, a count) beside the title on a phone instead of under it. */ inlineMeta?: boolean }) {
  return (
    <li className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-surface-muted/60 sm:flex-nowrap sm:px-5">
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">
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
      {meta && <div className={`min-w-0 max-w-full text-sm text-ink-muted tabular-nums sm:shrink-0 sm:basis-auto ${inlineMeta ? "shrink-0" : "basis-full max-sm:[&>*]:justify-start"}`}>{meta}</div>}
    </li>
  );
}

/**
 * A figure with its label, for the small counts at the top of a page: a small muted label over a 28 px figure. `attention` (a state tone) is only for a
 * number that needs a person ("To map 1"): a coloured bar at the left, and the words in the label still carry the meaning.
 */
export function Stat({ label, value, hint, href, attention }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; attention?: "warning" | "danger" }) {
  const body = (
    <>
      <div className="text-sm text-ink-muted">{label}</div>
      <div className="mt-1 text-stat font-semibold text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-small text-ink-muted">{hint}</div>}
    </>
  );
  const bar = attention === "danger" ? "border-l-[3px] border-l-danger" : attention === "warning" ? "border-l-[3px] border-l-warning" : "";
  const cls = `block h-full rounded-lg border border-border bg-surface px-4 py-3 shadow-card ${bar}`;
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-accent-edge hover:bg-surface-muted/50`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
