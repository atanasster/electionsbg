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
      <main className="min-h-[100vh] bg-card overflow-y-auto">
        {isLoading && <Loader />}
        <div className="container mx-auto flex flex-col justify-center items-center p-5">
          {props.children}
        </div>
      </main>
      <Footer />
    </>
  );
};
