import { Link } from "react-router-dom";
import { useNewsLocale } from "../i18n";

export const Breadcrumbs = ({
  items,
}: {
  items: { label: string; to?: string }[];
}) => {
  const { tr } = useNewsLocale();
  return (
    <nav
      className="text-sm text-muted-foreground"
      aria-label={tr("Навигационен път", "Breadcrumbs")}
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li
              key={`${item.label}-${index}`}
              className="flex items-center gap-1.5"
            >
              {index ? <span aria-hidden>/</span> : null}
              {item.to && !current ? (
                <Link to={item.to} className="hover:text-primary">
                  {item.label}
                </Link>
              ) : (
                <span
                  className="text-foreground"
                  aria-current={current ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
