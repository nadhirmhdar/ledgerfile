import { cloneElement, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const CONTROL =
  "block w-full min-h-10 rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-subtle disabled:bg-surface-muted disabled:text-ink-muted aria-[invalid=true]:border-danger";

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
 * A visible label above one control, with an optional hint and error. The control's id, aria-describedby and aria-invalid are set
 * for it, so the label, hint and error are read with the input.
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
        <p id={hintId} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger-strong">
          {error}
        </p>
      )}
    </div>
  );
}
