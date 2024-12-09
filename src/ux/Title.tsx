import { cn } from "@/lib/utils";
import { SEO } from "./SEO";
import { H1 } from "./H1";
export const Title: React.FC<
  React.ComponentProps<"h1"> & {
    description?: string;
    children: string;
  }
> = ({ className, children, description, ...props }) => {
  const label = (
    <H1
      className={cn(
        "text-3xl font-extrabold leading-tight tracking-tighter md:text-4xl text-center py-4 md:py-12 sm:py-4 text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </H1>
  );
  return description ? (
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
