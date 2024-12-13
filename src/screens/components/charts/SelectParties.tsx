import { PartyInfo, PartyVotes } from "@/data/dataTypes";
import { FC, useState } from "react";
import { PartyLabel } from "../PartyLabel";
import { Checkbox } from "@/components/ui/checkbox";
import { formatThousands } from "@/data/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Hint } from "@/ux/Hint";

export const SelectParties: FC<{
  votes?: PartyVotes[];
  subTitle?: string;
  onChangeSelected?: (selected: string[]) => void;
}> = ({ votes, subTitle, onChangeSelected }) => {
  const [unselected, setUnselected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const saveSelected = (newItems: string[] = []) => {
    setUnselected(newItems);
  };
  const addUnselected = (nickName?: string) => {
    const idx = unselected.findIndex((u) => u === nickName);
    if (idx < 0 && nickName) {
      saveSelected([...unselected, nickName]);
    }
  };
  const removeUnselected = (nickName?: string) => {
    const idx = unselected.findIndex((u) => u === nickName);
    if (idx >= 0) {
      const newItem = [...unselected];
      newItem.splice(idx, 1);
      saveSelected(newItem);
    }
  };
  const { t } = useTranslation();
  const isXSmall = useMediaQueryMatch("xs");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="secondary"
        className="my-2"
        onClick={() => setOpen(true)}
      >
        {`${t("select_parties")}...`}
      </Button>
      <DialogContent className="md:max-w-lg text-primary min-w-fit">
        <DialogHeader>
          <DialogTitle>{t("select_parties")}</DialogTitle>
          <DialogDescription>{subTitle}</DialogDescription>
        </DialogHeader>
        <div>
          <div className="flex gap-4 pb-2">
            <Button
              variant="ghost"
              className="lowercase"
              onClick={() => saveSelected([])}
              disabled={!unselected.length}
            >
              {t("select_all")}
            </Button>
            <Button
              variant="ghost"
              className="lowercase"
              disabled={unselected.length === votes?.length}
              onClick={() =>
                saveSelected(votes?.map((v) => v.nickName as string))
              }
            >
              {t("unselect_all")}
            </Button>
          </div>
          <div
            className={`grid ${isXSmall ? "grid-rows-11" : "grid-rows-5"} grid-flow-col gap-2 `}
          >
            {votes?.map((vote) => {
              return (
                <div
                  className="flex items-center border-2 border-primary"
                  key={vote.nickName}
                >
                  <Checkbox
                    className="ml-2"
                    checked={!unselected.find((u) => u === vote.nickName)}
                    onCheckedChange={(checked: boolean) => {
                      if (checked) {
                        removeUnselected(vote.nickName);
                      } else {
                        addUnselected(vote.nickName);
                      }
                    }}
                  />
                  <Hint
                    className="w-full"
                    text={`${vote ? vote?.name : t("unknown_party")}`}
                    underline={false}
                  >
                    <PartyLabel
                      party={vote as PartyInfo}
                      className="flex gap-2 text-sm ml-2 "
                    >
                      <div className="text-sm font-semibold">
                        {formatThousands(vote.totalVotes)}
                      </div>
                    </PartyLabel>
                  </Hint>
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("close")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="default"
            onClick={() => {
              if (onChangeSelected) {
                onChangeSelected(unselected);
              }
              setOpen(false);
            }}
          >
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
