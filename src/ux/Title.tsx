import { cn } from "@/lib/utils";
import { SEO } from "./SEO";
import { H1 } from "./H1";
import { ReactNode } from "react";
export const Title: React.FC<
  React.ComponentProps<"h1"> & {
    description?: string;
    title?: string;
    children: string | ReactNode;
  }
> = ({ className, children, description, title, ...props }) => {
  const label = (
    <H1
      className={cn(
        "text-2xl sm:text-3xl md:text-4xl font-extrabold leading-tight tracking-tight text-left py-3 md:py-5 text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </H1>
  );
  return description && (typeof children === "string" || title) ? (
    <>
      <SEO
        title={typeof children === "string" ? children : title || ""}
        description={description}
      />

      {label}
    </>
  ) : (
    label
  );
};
