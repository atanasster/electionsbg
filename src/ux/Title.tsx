import { cn } from "@/lib/utils";
import { SEO } from "./SEO";
import { H1 } from "./H1";
import { ReactNode } from "react";
export const Title: React.FC<
  React.ComponentProps<"h1"> & {
    description?: string;
    children: string | ReactNode;
  }
> = ({ className, children, description, ...props }) => {
  const label = (
    <H1
      className={cn(
        "text-xl md:text-4xl lg:text-3xl font-extrabold leading-tight tracking-tighter text-center py-4 md:py-12 sm:py-4 text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </H1>
  );
  return description && typeof children === "string" ? (
    <>
      <SEO
        title={children}
        description={description}
        keywords={["bulgaria", "elections"]}
      />

      {label}
    </>
  ) : (
    label
  );
};
