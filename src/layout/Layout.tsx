import React from "react";
import { Header } from "@/layout/Header";
import { Footer } from "@/layout/Footer";

export const Layout = (props: React.PropsWithChildren) => {
  return (
    <>
      <Header />
      <main className="min-h-[300] bg-card overflow-y-auto">
        <div className="container flex flex-col justify-center items-center p-2 pt-[70px]">
          {props.children}
        </div>
      </main>
      <Footer />
    </>
  );
};
