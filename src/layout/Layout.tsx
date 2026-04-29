import React from "react";
import { Footer } from "@/layout/Footer";
import { Header } from "./header/Header";

export const Layout = (props: React.PropsWithChildren) => {
  return (
    <>
      <Header />
      <main className="min-h-[100vh] bg-card overflow-y-auto">
        {/*
          `items-stretch` (the flex-col default) makes children fill the
          container width regardless of their intrinsic content. The previous
          `items-center` sized children to their content width — so any
          screen whose width changed during async load (skeleton → live)
          horizontally jumped, contributing to CLS. Screens that want
          narrower centered content (most data-table pages, error pages,
          AboutScreen) already self-center with `mx-auto max-w-*`, so
          dropping items-center doesn't widen them visually.
        */}
        <div className="container flex flex-col justify-center items-stretch p-2 pt-[70px]">
          {props.children}
        </div>
      </main>
      <Footer />
    </>
  );
};
