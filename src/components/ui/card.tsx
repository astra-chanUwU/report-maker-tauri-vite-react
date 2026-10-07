import * as React from "react";
import { cn } from "../../lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-none bg-card text-card-foreground",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1 px-3 pt-3 pb-2", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("text-[13px] leading-tight font-semibold tracking-tight", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("text-xs leading-snug text-muted-foreground", className)}
      {...props}
    />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("px-3 pb-3", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center gap-2 border-t px-3 py-2.5", className)}
      {...props}
    />
  )
);
CardFooter.displayName = "CardFooter";

/** Card with a title row that can carry actions on the trailing edge. */
function Panel({
  title,
  description,
  icon,
  actions,
  children,
  className,
  contentClassName,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
}) {
  return (
    <Card className={className} id={id}>
      <div className="flex items-start gap-2 border-b border-border/70 bg-transparent px-3 py-2.5">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <CardTitle className="flex items-center gap-1.5">
            {icon ? (
              <span className="text-muted-foreground [&_svg]:size-3.5" aria-hidden="true">
                {icon}
              </span>
            ) : null}
            {title}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
      {children !== undefined && children !== null ? (
        <CardContent className={cn("bg-card", contentClassName)}>{children}</CardContent>
      ) : null}
    </Card>
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, Panel };
