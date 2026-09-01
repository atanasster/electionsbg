import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import type { Story } from "../data";
import { formatDate, media } from "../labels";
import { useNewsLocale } from "../i18n";

export const RelatedStories = ({ stories }: { stories: Story[] }) => {
  const { language, tr } = useNewsLocale();
  if (stories.length === 0) return null;
  return (
    <Card className="p-4">
      <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {tr("Свързани истории", "Related stories")}
      </h2>
      <ul className="divide-y">
        {stories.map((story) => (
          <li key={story.id} className="py-3 first:pt-1 last:pb-0">
            <Link
              to={`/story/${story.id}`}
              className="block font-medium leading-snug hover:text-primary"
            >
              {(language === "en" ? story.title_en : story.title_bg) ??
                tr("История без заглавие", "Untitled story")}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {media(story.aggregates.outlet_count, language)}
              {story.first_published
                ? ` · ${formatDate(story.first_published, language)}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
};
