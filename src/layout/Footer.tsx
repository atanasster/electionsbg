import { Anchor } from "@/ux/Anchor";
import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";
import { GROUP_URL } from "@/lib/community";

export const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer className="footer flex p-4 bg-muted justify-end sm:justify-between">
      <div className="text-sm font-medium lowercase text-secondary-foreground hidden sm:flex whitespace-nowrap">
        {`© ${new Date().getFullYear()}. ${t("all_rights_reserved")}.`}
      </div>
      {/* Six links do not fit a 375px row, and without these the row does not wrap — each
          LINK does, mid-label ("за / нас", "наясно / ai"). Wrap between items instead. */}
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
            href="https://ai.electionsbg.com"
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            Наясно AI
          </Anchor>
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
