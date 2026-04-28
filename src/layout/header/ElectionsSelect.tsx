import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useElectionContext } from "@/data/ElectionContext";
import { prefetchElection } from "@/data/prefetch";
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
  const currentIdx = elections.findIndex((v) => v === selected);
  const priorElection = elections[currentIdx + 1];
  const nextElection = currentIdx > 0 ? elections[currentIdx - 1] : undefined;
  return (
    <div className="flex gap-2 items-center pl-2 sm:pl-0 md:pl-10 lg:pl-32  xl:pl-52">
      <Hint text={t("prior_elections")}>
        <Button
          variant="outline"
          className="size-8 md:size-10"
          onMouseEnter={() => prefetchElection(priorElection)}
          onFocus={() => prefetchElection(priorElection)}
          onClick={() => {
            if (priorElection) {
              setSelected(priorElection);
            }
          }}
          disabled={!priorElection}
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
          aria-label={t("select_election_year")}
          className="w-[125px] md:w-[150px] text-sm text-secondary-foreground px-2"
          onMouseEnter={() => {
            // When the user reaches for the dropdown, warm both neighbors.
            prefetchElection(priorElection);
            prefetchElection(nextElection);
          }}
        >
          <SelectValue placeholder={selected} />
        </SelectTrigger>
        <SelectContent>
          {localDates.map((l) => (
            <SelectItem
              className="text-sm text-secondary-foreground"
              key={l.original}
              value={l.original}
              onMouseEnter={() => prefetchElection(l.original)}
              onFocus={() => prefetchElection(l.original)}
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
          onMouseEnter={() => prefetchElection(nextElection)}
          onFocus={() => prefetchElection(nextElection)}
          onClick={() => {
            if (nextElection) {
              setSelected(nextElection);
            }
          }}
          disabled={!nextElection}
        >
          <ArrowBigRight className="text-secondary-foreground" />
          <span className="sr-only">{t("next_elections")}</span>
        </Button>
      </Hint>
    </div>
  );
};
