import React from "react";
import { Header } from "@/layout/Header";
import { Footer } from "@/layout/Footer";
import { Loader } from "@/ux/Loader";
import { useLoading } from "@/ux/useLoading";

export const Layout = (props: React.PropsWithChildren) => {
  const { isLoading } = useLoading();
  return (
    <>
      <Header />
      <main className="min-h-[300] bg-card overflow-y-auto">
        {isLoading && <Loader />}
        <div className="container flex flex-col justify-center items-center p-2 pt-12">
          {props.children}
        </div>
      </main>
      <Footer />
    </>
  );
};
