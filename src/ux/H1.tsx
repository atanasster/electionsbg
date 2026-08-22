import { cn } from "@/lib/utils";
export const H1: React.FC<React.ComponentProps<"h1">> = ({
  className,
  children,
  ...props
}) => (
  <h1
    className={cn(
      "text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl md:text-4xl text-left py-3 md:py-5 text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </h1>
);
