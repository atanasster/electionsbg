import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";

export const Footer = () => {
  const { t } = useTranslation();
  return (
    <footer className="footer flex p-4 bg-muted text-primary justify-between invisible lg:visible">
      <div className="text-sm sm:text-center whitespace-nowrap flex">
        {`© ${new Date().getFullYear()}. ${t("all_rights_reserved")}.`}
      </div>
      <ul className="flex flex-wrap items-center mt-3 text-md sm:mt-0">
        <li>
          <Link to={{ pathname: "/" }} aria-label="about" className="mx-2">
            {t("about")}
          </Link>
        </li>
        <li>
          <a
            href="https://github.com/atanasster/electionsbg"
            aria-label="github repository"
            className="mx-2 link hover:underline hover:cursor-pointer"
          >
            {t("open_source")}
          </a>
        </li>
      </ul>
    </footer>
  );
};
