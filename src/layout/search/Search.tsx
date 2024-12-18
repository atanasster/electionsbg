import { Command as CommandPrimitive } from "cmdk";
import {
  FC,
  useState,
  useRef,
  useCallback,
  type KeyboardEvent,
  useContext,
} from "react";

import { CommandInput, CommandList } from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchItems } from "./SearchItems";
import { Button } from "@/components/ui/button";
import { SearchIcon } from "lucide-react";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { cn } from "@/lib/utils";
import { FuseResult } from "fuse.js";
import { SearchIndexType } from "@/data/search/useSearchItems";
import { SearchContext, SearchContextProvider } from "./SearchContext";
import { useTranslation } from "react-i18next";
import { useNavigateParams } from "@/ux/useNavigateParams";

const SearchInternal: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigateParams();
  const [open, setIsOpen] = useState<boolean>(false);
  const [value, setValue] = useState("");
  const { arrowDown, arrowUp, selected, setSelected, setSearchTerm } =
    useContext(SearchContext);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const setOpen = useCallback(
    (value: boolean) => {
      if (!value) {
        setSelected(-1);
      }
      setIsOpen(value);
    },
    [setSelected],
  );
  const handleValueChange = useCallback(
    (value: string) => {
      setSearchTerm(value);
      setValue(value);
      //setIsOpen(!!value && value.length > 2);
    },
    [setSearchTerm],
  );
  const isMedium = useMediaQueryMatch("lg");
  const handleSelectOption = useCallback(
    (selectedOption: FuseResult<SearchIndexType>) => {
      switch (selectedOption.item.type) {
        case "c":
          navigate({ pathname: `/section/${selectedOption.item.key}` });
          break;
        case "s":
          navigate({ pathname: `/sections/${selectedOption.item.key}` });
          break;
        case "m":
          navigate({ pathname: `/settlement/${selectedOption.item.key}` });
          break;
        case "r":
          navigate({ pathname: `/municipality/${selectedOption.item.key}` });
          break;
      }
      setOpen(false);
      inputRef?.current?.blur();
    },
    [navigate, setOpen],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const input = inputRef.current;
      if (!input) {
        return;
      }

      // Keep the options displayed when the user is typing
      if (!open) {
        setOpen(true);
      }

      // This is not a default behaviour of the <input /> field
      if (event.key === "Enter") {
        if (selected) {
          handleSelectOption(selected);
          handleValueChange("");
        }
      }

      if (event.key === "Escape") {
        input.blur();
      }
      if (event.key === "ArrowUp") {
        arrowUp();
      }
      if (event.key === "ArrowDown") {
        arrowDown();
      }
      if (event.key === "Tab") {
        input.blur();
        if (buttonRef.current) {
          buttonRef.current.focus();
        }
      }
    },

    [
      arrowDown,
      arrowUp,
      handleSelectOption,
      handleValueChange,
      open,
      selected,
      setOpen,
    ],
  );

  const handleBlur = useCallback(() => {
    setOpen(false);
  }, [setOpen]);
  const command = (
    <CommandPrimitive onKeyDown={handleKeyDown}>
      <div className="text-secondary-foreground bg-secondary">
        <CommandInput
          ref={inputRef}
          value={value}
          onValueChange={handleValueChange}
          onBlur={isMedium ? handleBlur : undefined}
          onFocus={() => setOpen(true)}
          placeholder={`${t("search")}...`}
        />
      </div>
      <div className="relative mt-1 ">
        <div
          className={cn(
            "animate-in fade-in-0 zoom-in-95 absolute top-0 z-10 text-popover-foreground bg-popover outline-none",
            open ? "block" : "hidden",
          )}
        >
          <CommandList className="shadow-md ring-1 ring-slate-200 rounded-md w-[300px] ">
            {value.length > 0 && (
              <>
                <SearchItems onSelect={handleSelectOption} />
              </>
            )}
            <CommandPrimitive.Empty className="select-none px-2 py-3 text-center text-sm">
              {t("no_results")}
            </CommandPrimitive.Empty>
          </CommandList>
        </div>
      </div>
    </CommandPrimitive>
  );
  return isMedium ? (
    command
  ) : (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={buttonRef}
          variant="ghost"
          role="button"
          className="text-secondary-foreground w-[28px] "
          onBlur={handleBlur}
        >
          <SearchIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[300px] p-0"
        onInteractOutside={(e) => {
          if (
            e.target instanceof Element &&
            (e.target.hasAttribute("cmdk-input") ||
              e.target === buttonRef.current)
          ) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {command}
      </PopoverContent>
    </Popover>
  );
};

export const Search: FC = () => (
  <SearchContextProvider>
    <SearchInternal />
  </SearchContextProvider>
);
