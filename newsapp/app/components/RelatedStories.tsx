import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import type { Story } from "../data";
import { formatDate } from "../labels";

export const RelatedStories = ({ stories }: { stories: Story[] }) => {
  if (stories.length === 0) return null;
  return (
    <Card className="p-4">
      <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Свързани истории
      </h2>
      <ul className="divide-y">
        {stories.map((story) => (
          <li key={story.id} className="py-3 first:pt-1 last:pb-0">
            <Link
              to={`/story/${story.id}`}
              className="block font-medium leading-snug hover:text-primary"
            >
              {story.title_bg ?? story.title_en ?? "История без заглавие"}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {story.aggregates.outlet_count === 1
                ? "1 медия"
                : `${story.aggregates.outlet_count} медии`}
              {story.first_published
                ? ` · ${formatDate(story.first_published)}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
};
