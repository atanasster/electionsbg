import { cn } from "@/lib/utils";
import { SEO } from "./SEO";
export const Title: React.FC<
  React.ComponentProps<"h2"> & {
    description: string;
    children: string;
  }
> = ({ className, children, description, ...props }) => {
  return (
    <>
      <SEO
        title={children}
        description={description}
        keywords={["bulgaria", "elections"]}
      />

      <h2
        className={cn(
          "text-3xl font-extrabold leading-tight tracking-tighter md:text-4xl text-center py-4 md:py-12 sm:py-4 text-muted-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </h2>
    </>
  );
};
