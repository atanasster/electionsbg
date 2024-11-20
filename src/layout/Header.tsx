import { useContext } from "react";
import { Moon, SunMedium, Menu, Vote } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { themeDark, themeLight } from "@/theme/utils";
import { ThemeContext } from "@/theme/ThemeContext";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { Button } from "@/components/ui/button";

export const Header = () => {
  const { setTheme, theme } = useContext(ThemeContext);
  const { t, i18n } = useTranslation();

  return (
    <div className="flex gap-6 md:gap-10 bg-muted border-b-2">
      <div className="w-full text-xl text-primary flex flex-wrap items-center justify-between mx-auto p-4">
        <Link to="/" className="flex flex-row items-center">
          <span className="sr-only">Elections in Bulgaria data statistics</span>
          <Vote />
          <div className="flex font-title ext-2xl transition-all duration-200 pl-2">
            <div className="lowercase text-popover-foreground">
              {t("elections")}
            </div>
            <div className="font-semibold uppercase">{t("bg")}</div>
          </div>
        </Link>
      </div>
      <nav className="flex gap-6 items-center px-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="font-medium text-muted-foreground hidden md:block lowercase"
              aria-label="Open reports menu"
            >
              {t("reports")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>{t("anomaly_reports")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("municipalities")}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/municipality/concentrated",
                        }}
                      >
                        {t("concentrated_party_votes")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/municipality/turnout",
                        }}
                      >
                        {t("voter_turnout")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/municipality/invalid_ballots",
                        }}
                      >
                        {t("invalid_ballots")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/municipality/additional_voters",
                        }}
                      >
                        {t("additional_voters")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/municipality/supports_no_one",
                        }}
                      >
                        {t("support_no_one")}
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("settlements")}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/settlement/concentrated",
                        }}
                      >
                        {t("concentrated_party_votes")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/settlement/turnout",
                        }}
                      >
                        {t("voter_turnout")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/settlement/invalid_ballots",
                        }}
                      >
                        {t("invalid_ballots")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/settlement/additional_voters",
                        }}
                      >
                        {t("additional_voters")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/settlement/supports_no_one",
                        }}
                      >
                        {t("support_no_one")}
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("sections")}</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/section/concentrated",
                        }}
                      >
                        {t("concentrated_party_votes")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/section/turnout",
                        }}
                      >
                        {t("voter_turnout")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/section/invalid_ballots",
                        }}
                      >
                        {t("invalid_ballots")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/section/additional_voters",
                        }}
                      >
                        {t("additional_voters")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link
                        to={{
                          pathname: "/reports/section/supports_no_one",
                        }}
                      >
                        {t("support_no_one")}
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          className="font-medium text-muted-foreground hidden md:block"
          aria-label="Change language"
          onClick={() => {
            if (i18n.language === "bg") {
              i18n.changeLanguage("en");
            } else {
              i18n.changeLanguage("bg");
            }
          }}
        >
          {t("changeLanguageTo")}
        </button>
        <button
          onClick={() => setTheme(theme === themeDark ? themeLight : themeDark)}
          id="theme-toggle"
          type="button"
          aria-label="switch theme dark mode"
          className="inline-flex items-center p-2 w-10 h-10 justify-center rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
        >
          {theme === themeDark ? <SunMedium /> : <Moon />}
        </button>
        <button
          data-collapse-toggle="navbar-default"
          type="button"
          className="inline-flex items-center p-2 w-10 h-10 justify-center rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
          aria-controls="navbar-default"
          aria-expanded="false"
        >
          <span className="sr-only">Open main menu</span>
          <Menu />
        </button>
      </nav>
    </div>
  );
};
