import { cn } from "@/lib/utils";
export const Caption: React.FC<React.ComponentProps<"h2">> = ({
  className,
  ...props
}) => (
  <h2
    className={cn(
      "text-secondary-foreground text-md md:text-2xl font-bold md:font-extrabold leading-tight tracking-tighter text-center py-2",
      className,
    )}
    {...props}
  />
);
