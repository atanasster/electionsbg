import React from "react";
import { Header } from "@/layout/Header";
import { Footer } from "@/layout/Footer";
import { NotificationsStack } from "./NotificationsStack";
import { Loader } from "@/ux/Loader";
import { useLoading } from "@/ux/useLoading";

export const Layout = (props: React.PropsWithChildren) => {
  const { isLoading } = useLoading();
  return (
    <>
      <Header />
      <NotificationsStack />
      <main className="flex flex-col justify-between items-center min-h-[100vh]">
        {isLoading && <Loader />}
        {props.children}
      </main>
      <Footer />
    </>
  );
};
