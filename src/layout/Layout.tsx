import React from "react";
import { Footer } from "@/layout/Footer";
import { Header } from "./header/Header";

export const Layout = (props: React.PropsWithChildren) => {
  return (
    <>
      <Header />
      <main className="min-h-[100vh] bg-card overflow-y-auto">
        <div className="container flex flex-col justify-center items-center p-2 pt-[70px]">
          {props.children}
        </div>
      </main>
      <Footer />
    </>
  );
};
