import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary ring-primary/20",
        secondary: "bg-muted text-muted-foreground ring-border",
        destructive: "bg-red-500/10 text-red-400 ring-red-500/20",
        warning: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
        success: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
