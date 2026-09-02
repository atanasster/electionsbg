import React from "react";
import { Footer } from "@/layout/Footer";
import { CommunityCtaStrip } from "@/screens/components/CommunityCtaStrip";
import { Header } from "./header/Header";

export const Layout = (props: React.PropsWithChildren) => {
  return (
    <>
      <Header />
      {/* `flow-root`, NOT `overflow-y-auto`. Both establish the block
          formatting context this wants, but Tailwind's overflow-y utility makes
          `overflow-x` compute to `auto` as well, which turns <main> into the
          SCROLL CONTAINER for every descendant — and since its height is
          content-driven it never scrolls itself, so `position: sticky` inside
          it has nothing to stick to and silently does nothing. Measured
          2026-09-02: the /data detail card and toolbar both computed
          `position: sticky` and scrolled away with the page.

          Sticky resolves against the NEAREST scrollport, so this only ever
          reached descendants with no closer scroll container. Of the five other
          `sticky top-*` users, three sit inside their own `overflow-auto` box
          (EducationPlaceTile, SqlBrowserScreen, EntitySearchTile) and were
          never affected; two are document-scrolled and become live with this
          change — BudgetTaxCalculator and BudgetPolicySimulator, both given the
          height ceiling a newly-pinning Card needs. The class dates to the
          original sticky-header commit and never produced a scrollbar. */}
      <main className="min-h-[100vh] bg-card flow-root">
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
        <div className="container flex flex-col justify-center items-stretch p-2 pt-[var(--header-height,70px)]">
          <CommunityCtaStrip />
          {props.children}
        </div>
      </main>
      <Footer />
    </>
  );
};
