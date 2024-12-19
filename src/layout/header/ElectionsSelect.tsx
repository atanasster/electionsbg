import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { ArrowBigLeft, ArrowBigRight } from "lucide-react";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";

export const ElectionsSelect: FC = () => {
  const { elections, selected, setSelected } = useElectionContext();
  const { t } = useTranslation();
  const localDates = useMemo(() => {
    return elections.map((e) => {
      return {
        local: localDate(e),
        original: e,
      };
    });
  }, [elections]);
  return (
    <div className="flex gap-2 items-center">
      <Hint text={t("prior_elections")}>
        <Button
          variant="outline"
          className="size-8 md:size-10"
          onClick={() => {
            const idx = elections.findIndex((v) => v === selected);
            if (idx < elections.length - 1) {
              setSelected(elections[idx + 1]);
            }
          }}
          disabled={
            elections.findIndex((v) => v === selected) >= elections.length - 1
          }
        >
          <ArrowBigLeft className="text-secondary-foreground" />
          <span className="sr-only">{t("prior_elections")}</span>
        </Button>
      </Hint>
      <Select
        value={localDates.find((l) => l.original === selected)?.original}
        onValueChange={(e) => {
          setSelected(e);
        }}
      >
        <SelectTrigger
          id="select_election"
          className="w-[125px] md:w-[150px] md:text-lg text-secondary-foreground px-2"
        >
          <SelectValue placeholder={selected} />
          <span className="sr-only">Select election year</span>
        </SelectTrigger>
        <SelectContent>
          {localDates.map((l) => (
            <SelectItem
              className="md:text-lg text-secondary-foreground"
              key={l.original}
              value={l.original}
            >
              {l.local}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Hint text={t("next_elections")}>
        <Button
          className="size-8 md:size-10"
          variant="outline"
          onClick={() => {
            const idx = elections.findIndex((v) => v === selected);
            if (idx > 0) {
              setSelected(elections[idx - 1]);
            }
          }}
          disabled={elections.findIndex((v) => v === selected) <= 0}
        >
          <ArrowBigRight className="text-secondary-foreground" />
          <span className="sr-only">{t("next_elections")}</span>
        </Button>
      </Hint>
    </div>
  );
};
