import type { HTMLAttributes, ReactNode, TdHTMLAttributes } from "react";

/**
 * A real table, for figures and for lists of records with several columns. One style: a light heading (13 px, muted, one hairline under it), row
 * hairlines, 12 px above and below each cell, a hover tint on a row, and every figure in tabular numerals, right-aligned.
 */
export function Table({ caption, sticky = false, children, className = "" }: { caption?: string; sticky?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-x-auto rounded-lg border border-border bg-surface shadow-card ${sticky ? "max-h-[70vh] overflow-y-auto" : ""} ${className}`}>
      <table className="w-full text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ sticky = false, children }: { sticky?: boolean; children: ReactNode }) {
  return <thead className={`border-b border-border bg-surface text-small text-ink-subtle ${sticky ? "sticky top-0 z-10" : ""}`}>{children}</thead>;
}

export function TRow({ children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...props} className={`border-b border-border transition-colors last:border-b-0 hover:bg-surface-muted/50 ${props.className ?? ""}`}>
      {children}
    </tr>
  );
}

/** A totals row: a rule above it and 600 weight, so a total reads as the sum of the rows over it. */
export function TTotalRow({ children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...props} className={`border-t-2 border-border-strong font-semibold ${props.className ?? ""}`}>
      {children}
    </tr>
  );
}

/** A cell. `header` makes it a column or row heading; `numeric` right-aligns it with tabular figures. */
export function TCell({
  header,
  numeric = false,
  children,
  className = "",
  ...props
}: Omit<TdHTMLAttributes<HTMLTableCellElement>, "scope"> & { header?: "col" | "row"; numeric?: boolean }) {
  const cls = `px-4 ${header === "col" ? "py-2.5" : "py-3"} ${numeric ? "text-right tabular-nums whitespace-nowrap" : ""} ${header === "col" ? "font-semibold" : ""} ${header === "row" ? "min-w-44 font-medium text-ink" : ""} ${className}`;
  return header ? (
    <th {...props} scope={header} className={cls}>
      {children}
    </th>
  ) : (
    <td {...props} className={cls}>
      {children}
    </td>
  );
}
