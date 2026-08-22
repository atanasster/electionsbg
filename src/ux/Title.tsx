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
  // No class string here. H1 already applies exactly these declarations as its base, and
  // because cn()/twMerge gives the caller's classes precedence, restating them made Title
  // SHADOW that base — so a future edit to H1 would silently not reach Title's 181
  // importers, which is the opposite of the "they move together" property the two rely on.
  const label = (
    <H1 className={className} {...props}>
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
