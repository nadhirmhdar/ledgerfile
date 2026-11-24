import { cloneElement, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { buttonClass } from "./button";
import { SearchIcon } from "./icons";

// A 40 px field with a soft edge (3.4:1, so it is still seen), a firmer edge on hover and an accent edge with the focus ring on focus.
const CONTROL =
  "block w-full min-h-10 rounded-md border border-border-input bg-surface px-3 py-2 text-base text-ink transition-colors hover:border-border-strong focus-visible:border-accent disabled:bg-surface-muted disabled:text-ink-muted aria-[invalid=true]:border-danger";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL} min-h-24 ${props.className ?? ""}`} />;
}

/**
 * A search field with its button attached: one control, the field and the button sharing an edge. The caller's form supplies the action; this is
 * the label, the field and the button only.
 */
export function SearchField({
  id,
  name = "q",
  label,
  defaultValue,
  placeholder,
  buttonLabel = "Search",
  className = "",
}: {
  id: string;
  name?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  buttonLabel?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle" />
          <input id={id} name={name} type="search" defaultValue={defaultValue} placeholder={placeholder} className={`${CONTROL} rounded-r-none pl-9`} />
        </div>
        <button className={buttonClass("secondary", "md", "-ml-px rounded-l-none")}>{buttonLabel}</button>
      </div>
    </div>
  );
}

/**
 * A visible label above one control, with an optional hint and error. The control's id, aria-describedby and aria-invalid are set
 * for it, so the label, hint and error are read with the input. The rhythm is label, 4 px, field, 4 px, hint or error.
 */
export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: ReactNode; error?: ReactNode; children: ReactElement<{ id?: string }>; className?: string }) {
  const base = useId();
  const id = isValidElement(children) && children.props.id ? children.props.id : `${base}-control`;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      {cloneElement(children as ReactElement<Record<string, unknown>>, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && (
        <p id={hintId} className="mt-1 text-small text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-small font-medium text-danger-strong">
          {error}
        </p>
      )}
    </div>
  );
}
