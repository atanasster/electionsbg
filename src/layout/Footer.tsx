import { Anchor } from "@/ux/Anchor";
import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";
import { GROUP_URL } from "@/lib/community";
import { cn } from "@/lib/utils";
import { siteChrome } from "@/layout/siteChrome";

export const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer
      className={cn(
        siteChrome.footerSurface,
        "footer flex justify-end p-4 sm:justify-between",
      )}
    >
      <div className="text-sm font-medium lowercase text-secondary-foreground hidden sm:flex whitespace-nowrap">
        {`© ${new Date().getFullYear()}. ${t("all_rights_reserved")}.`}
      </div>
      {/* Five links do not fit a 375px row, and without these the row does not wrap —
          each LINK does, mid-label ("за / нас"). Wrap between items instead.

          There were six: "Наясно AI" → /chat was removed 2026-09-10, because the
          chat is now invited from the homepage itself and a footer link is where
          a feature goes to be missed. */}
      <ul className="flex flex-wrap items-center justify-end gap-y-1 sm:mt-0">
        <li className="whitespace-nowrap">
          <Link
            to="/about"
            underline={false}
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            {t("about")}
          </Link>
        </li>
        <li className="whitespace-nowrap">
          <Link
            to="/data"
            underline={false}
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            {t("data_title")}
          </Link>
        </li>
        <li className="whitespace-nowrap">
          <Link
            to="/db"
            underline={false}
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            db
          </Link>
        </li>
        <li className="whitespace-nowrap">
          <Anchor
            href="https://github.com/atanasster/electionsbg"
            aria-label="GitHub"
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            GitHub
          </Anchor>
        </li>
        <li className="whitespace-nowrap">
          <Anchor
            href={GROUP_URL}
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            {t("community")}
          </Anchor>
        </li>
      </ul>
    </footer>
  );
};
