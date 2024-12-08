import { Anchor } from "@/ux/Anchor";
import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";

export const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer className="footer flex p-4 bg-muted text-primary justify-end sm:justify-between">
      <div className="text-sm hidden sm:flex whitespace-nowrap ">
        {`© ${new Date().getFullYear()}. ${t("all_rights_reserved")}.`}
      </div>
      <ul className="flex items-center text-md sm:mt-0">
        <li>
          <Link to="/about" aria-label="about" className="mx-2">
            {t("about")}
          </Link>
        </li>
        <li>
          <Anchor
            href="https://github.com/atanasster/electionsbg"
            aria-label="github repository"
            className="mx-2"
          >
            {t("open_source")}
          </Anchor>
        </li>
      </ul>
    </footer>
  );
};
