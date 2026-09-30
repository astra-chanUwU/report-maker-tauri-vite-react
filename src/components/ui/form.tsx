import * as React from "react";
import { cn } from "../../lib/utils";
import { Label } from "./label";

/** Label + control + hint/error, stacked. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ms-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          className="text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-8 w-full rounded-md border border-input bg-card px-2 text-[13px] shadow-xs hover:border-muted-foreground/50 focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Select.displayName = "Select";

/** Mutually exclusive button group (radio semantics). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "default",
  className,
}: {
  value: T;
  options: readonly { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex w-fit items-center justify-self-start rounded-md border border-input bg-muted p-0.5",
        size === "sm" ? "h-7" : "h-8",
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => !active && onChange(o.value)}
            className={cn(
              "inline-flex h-full cursor-default items-center justify-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Checkbox with label and optional one-line explanation. */
export function CheckRow({
  checked,
  onChange,
  label,
  description,
  id,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted/70",
        disabled && "opacity-60",
        className
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="grid gap-0.5">
        <span className="font-medium leading-tight">{label}</span>
        {description ? (
          <span className="text-xs leading-snug text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

const BADGE_TONES = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/12 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-[oklch(0.48_0.11_70)] dark:text-warning",
  danger: "bg-destructive/12 text-destructive",
} as const;

export function Badge({
  tone = "neutral",
  className,
  children,
  title,
}: {
  tone?: keyof typeof BADGE_TONES;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-semibold whitespace-nowrap",
        BADGE_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Centered placeholder for pages that have nothing to show yet. */
export function EmptyState({
  icon,
  title,
  children,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/60 px-6 py-12 text-center",
        className
      )}
    >
      {icon ? (
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <div className="grid max-w-md gap-1">
        <p className="text-sm font-semibold">{title}</p>
        {children ? <div className="text-[13px] text-muted-foreground">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Small labelled metric tile. */
export function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-0.5 rounded-lg border bg-card px-3 py-2.5", className)}>
      <span className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="truncate text-base font-semibold tabular-nums">{value}</span>
      {sub ? <span className="truncate text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

/** Small uppercase heading used to group fields inside a card. */
export function FieldGroupTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "text-[11px] font-semibold tracking-wider text-muted-foreground uppercase",
        className
      )}
    >
      {children}
    </h3>
  );
}
