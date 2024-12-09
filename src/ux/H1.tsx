import { cn } from "@/lib/utils";
export const H1: React.FC<React.ComponentProps<"h1">> = ({
  className,
  children,
  ...props
}) => (
  <h1
    className={cn(
      "text-3xl font-extrabold leading-tight tracking-tighter md:text-4xl text-center py-4 md:py-12 sm:py-4 text-muted-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </h1>
);
