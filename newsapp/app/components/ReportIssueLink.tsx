import { correctionIssueUrl, type CorrectionPerson } from "../corrections";
import { useNewsLocale } from "../i18n";

export const ReportIssueLink = ({
  path,
  person,
  compact = false,
}: {
  path?: string;
  /** A signal about one person on the page (the person rail's rows). */
  person?: CorrectionPerson;
  compact?: boolean;
}) => {
  const { tr } = useNewsLocale();
  return (
    <a
      href={correctionIssueUrl(path, person)}
      target="_blank"
      rel="noreferrer noopener"
      className={
        compact
          ? "text-xs text-muted-foreground underline-offset-4 hover:underline"
          : "text-sm font-medium text-primary underline-offset-4 hover:underline"
      }
    >
      {compact
        ? tr("сигнализирай", "report")
        : tr("Сигнализирай проблем", "Report a problem")}{" "}
      <span aria-hidden>↗</span>
      <span className="sr-only">
        {" "}
        {tr("(отваря се в нов раздел)", "(opens in a new tab)")}
      </span>
    </a>
  );
};
