import { correctionIssueUrl } from "../corrections";
import { useNewsLocale } from "../i18n";

export const ReportIssueLink = ({ path }: { path?: string }) => {
  const { tr } = useNewsLocale();
  return (
    <a
      href={correctionIssueUrl(path)}
      target="_blank"
      rel="noreferrer noopener"
      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {tr("Сигнализирай проблем", "Report a problem")}{" "}
      <span aria-hidden>↗</span>
      <span className="sr-only">
        {" "}
        {tr("(отваря се в нов раздел)", "(opens in a new tab)")}
      </span>
    </a>
  );
};
