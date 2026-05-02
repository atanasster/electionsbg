import { Anchor } from "@/ux/Anchor";
import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";

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
          <Anchor
            href="https://github.com/atanasster/electionsbg"
            aria-label="github repository"
            className="mx-2 text-sm font-medium lowercase text-secondary-foreground hover:text-primary"
          >
            {t("open_source")}
          </Anchor>
        </li>
      </ul>
    </footer>
  );
};
