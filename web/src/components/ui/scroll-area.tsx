import { cn } from "@/lib/cn";
import { forwardRef } from "react";

export const ScrollArea = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("overflow-y-auto scrollbar-thin", className)}
    {...props}
  >
    {children}
  </div>
));

ScrollArea.displayName = "ScrollArea";
