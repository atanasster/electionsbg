import { Anchor } from "@/ux/Anchor";
import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";
import { GROUP_URL, PAGE_URL } from "@/lib/community";

export const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer className="footer flex p-4 bg-muted justify-end sm:justify-between">
      <div className="text-sm font-medium lowercase text-secondary-foreground hidden sm:flex whitespace-nowrap">
        {`© ${new Date().getFullYear()}. ${t("all_rights_reserved")}.`}
      </div>
      <ul className="flex items-center sm:mt-0">
        <li>
          <Link
            to="/about"
            underline={false}
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            {t("about")}
          </Link>
        </li>
        <li>
          <Link
            to="/data"
            underline={false}
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            {t("data_title")}
          </Link>
        </li>
        <li>
          <Anchor
            href="https://github.com/atanasster/electionsbg"
            aria-label={`${t("open_source")} — GitHub`}
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            {t("open_source")}
          </Anchor>
        </li>
        <li>
          <Anchor
            href={GROUP_URL}
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            {t("facebook_group")}
          </Anchor>
        </li>
        <li>
          <Anchor
            href={PAGE_URL}
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            {t("facebook_page")}
          </Anchor>
        </li>
      </ul>
    </footer>
  );
};
