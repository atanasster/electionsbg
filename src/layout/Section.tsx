import { HTMLProps } from "react";
import { Title } from "@/ux/Title";

export const Section: React.FC<
  React.PropsWithChildren<{ title?: string } & HTMLProps<HTMLDivElement>>
> = ({ title, className, children }) => (
  <section className={`w-full lg:pb-8 pb-2 px-4 md:px-8 ${className || ""}`}>
    {title && <Title className="lg:pt-12  md:pb-8 text-center">{title}</Title>}
    {children}
  </section>
);
