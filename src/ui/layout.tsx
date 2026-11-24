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
    <div className={`rounded-lg border bg-surface ${raised ? "border-border border-t-[3px] border-t-accent shadow-raised" : "border-border shadow-card"} ${className}`}>
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

/** One labelled fact in a page header: a small muted label over its value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-small text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium whitespace-nowrap text-ink">{children}</dd>
    </div>
  );
}

/** The client and the period of an engagement, as two labelled facts (the period on one line). */
export function EngagementFacts({ client, periodStart, periodEnd }: { client: string; periodStart: string; periodEnd: string }) {
  return (
    <>
      <div className="min-w-0">
        <dt className="text-small text-ink-subtle">Client</dt>
        <dd className="mt-0.5 text-sm font-medium text-ink">{client}</dd>
      </div>
      <Fact label="Period">
        {periodStart} to {periodEnd}
      </Fact>
    </>
  );
}

/**
 * The top of a page, and the one bold element on it: a band across the content column holding a back link with a chevron, the 30/600 title with the
 * page's actions on its baseline (under it when narrow), the page's facts as labelled fields (Client, Period, Status), an optional secondary note,
 * and the one status sentence. `facts` is a set of <Fact> items (a <dl>); `note` is for what is not a fact. A dot between two inline items passed as
 * `meta` is dropped: the gap is the separator.
 */
export function PageHeader({
  meta,
  title,
  subtitle,
  actions,
  breadcrumb,
  note,
}: {
  meta?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** A secondary line for what is not a fact (for example how the columns were read). */
  note?: ReactNode;
  /** Earlier crumbs are links; one with no href is the page the reader is on, shown as text. */
  breadcrumb?: { label: string; href?: string }[];
}) {
  const parents = (breadcrumb ?? []).filter((b) => b.href);
  const here = (breadcrumb ?? []).filter((b) => !b.href);
  return (
    <header className="rounded-lg border border-accent-edge/60 bg-gradient-to-r from-accent-wash via-accent-wash to-surface px-4 py-5 shadow-card sm:px-6 sm:py-6">
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <h1 className="min-w-0 text-2xl font-semibold text-ink">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {meta && <dl className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-3 border-t border-accent-edge/60 pt-4 text-sm text-ink-muted [&>[aria-hidden=true]]:hidden">{meta}</dl>}
      {note && <p className="mt-3 text-sm text-ink-muted">{note}</p>}
      {subtitle && <p className={`${meta || note ? "mt-3" : "mt-4"} text-base text-ink`}>{subtitle}</p>}
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
      <div className="mt-1 text-[1.75rem] leading-8 font-semibold text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-small text-ink-muted">{hint}</div>}
    </>
  );
  const tone = attention === "danger" ? "border-l-[3px] border-l-danger bg-danger-soft" : attention === "warning" ? "border-l-[3px] border-l-warning bg-warning-soft" : "bg-surface";
  const cls = `block h-full rounded-lg border border-border px-4 py-3 shadow-card ${tone}`;
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-accent-edge`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
