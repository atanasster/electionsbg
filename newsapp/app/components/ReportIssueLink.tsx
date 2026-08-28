import { correctionIssueUrl } from "../corrections";

export const ReportIssueLink = ({ path }: { path?: string }) => (
  <a
    href={correctionIssueUrl(path)}
    target="_blank"
    rel="noreferrer noopener"
    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
  >
    Сигнализирай проблем <span aria-hidden>↗</span>
    <span className="sr-only"> (отваря се в нов раздел)</span>
  </a>
);
