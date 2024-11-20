import { cn } from "@/lib/utils";
export const Caption: React.FC<React.ComponentProps<"h2">> = ({
  className,
  ...props
}) => (
  <h2
    className={cn(
      "text-2xl text-primary-foreground font-extrabold leading-tight text-center py-2",
      className,
    )}
    {...props}
  />
);
