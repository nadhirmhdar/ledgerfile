import type { HTMLAttributes, ReactNode, TdHTMLAttributes } from "react";

/** A real table, for figures and for lists of records with several columns. Numbers go in numeric cells, right-aligned. */
export function Table({ caption, sticky = false, children, className = "" }: { caption?: string; sticky?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-x-auto rounded-lg border border-border bg-surface ${sticky ? "max-h-[70vh] overflow-y-auto" : ""} ${className}`}>
      <table className="w-full text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ sticky = false, children }: { sticky?: boolean; children: ReactNode }) {
  return <thead className={`border-b-2 border-ink bg-surface-muted text-ink ${sticky ? "sticky top-0 z-10" : ""}`}>{children}</thead>;
}

export function TRow({ children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...props} className={`border-b border-border last:border-b-0 ${props.className ?? ""}`}>
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
  const cls = `px-4 py-2.5 ${numeric ? "text-right tabular-nums whitespace-nowrap" : ""} ${header === "col" ? "font-medium" : ""} ${header === "row" ? "font-semibold text-ink" : ""} ${className}`;
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
