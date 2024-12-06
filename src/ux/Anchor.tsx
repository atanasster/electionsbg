import { cn } from "@/lib/utils";
export const Anchor: React.FC<React.ComponentProps<"a">> = ({
  className,
  ...props
}) => (
  <a
    className={cn("link hover:underline hover:cursor-pointer", className)}
    {...props}
  />
);
