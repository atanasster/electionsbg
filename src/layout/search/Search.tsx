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
import { trackSearchSelection } from "@/lib/analytics";

const SearchInternal: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigateParams();
  const [open, setIsOpen] = useState<boolean>(false);
  const [value, setValue] = useState("");
  const {
    arrowDown,
    arrowUp,
    selected,
    setSelected,
    setSearchTerm,
    searchTerm,
    activate,
  } = useContext(SearchContext);
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
  // Expand into the inline command bar only on the widest screens; below that
  // the header is too crowded (logo + date + area pill + three section menus),
  // so search stays a compact icon that opens the same command in a popover.
  const isWide = useMediaQueryMatch("2xl");
  const handleSelectOption = useCallback(
    (selectedOption: FuseResult<SearchIndexType>) => {
      // Track search result selection in Google Analytics
      trackSearchSelection(
        searchTerm || "",
        selectedOption.item.type,
        selectedOption.item.key,
        selectedOption.item.name,
      );

      // Synthetic entries (София / Столична община) carry an explicit path
      // since they don't map to a /<type>/<key> route.
      if (selectedOption.item.path) {
        navigate({ pathname: selectedOption.item.path });
        setOpen(false);
        inputRef?.current?.blur();
        return;
      }

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
        case "d":
          // район shard — same route family as a município (/settlement/S2xxx).
          navigate({ pathname: `/settlement/${selectedOption.item.key}` });
          break;
        case "r":
          navigate({ pathname: `/municipality/${selectedOption.item.key}` });
          break;
        case "a":
          navigate({ pathname: `/candidate/${selectedOption.item.key}` });
          break;
        case "o":
          // Municipal official — keyed by the cacbg slug.
          navigate({ pathname: `/officials/${selectedOption.item.key}` });
          break;
        case "b":
          navigate({ pathname: `/budget/ministry/${selectedOption.item.key}` });
          break;
        case "v": {
          // Vote key format: "${date}|${slug}". Slug already carries the
          // "${itemNo}-${slugified-title}" form, so we prepend "item-" to
          // hit the canonical route pattern at /votes/:date/:slug.
          const [date, slug] = selectedOption.item.key.split("|");
          if (date && slug) {
            navigate({ pathname: `/votes/${date}/item-${slug}` });
          }
          break;
        }
      }
      setOpen(false);
      inputRef?.current?.blur();
    },
    [navigate, setOpen, searchTerm],
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
          onBlur={isWide ? handleBlur : undefined}
          onFocus={() => {
            // Mount the heavy SearchContextProvider on first focus so the
            // ~2.7 MB search index starts loading while the user is still
            // composing their query. The context is a stub until activate()
            // is called.
            activate();
            setOpen(true);
          }}
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
          <CommandList className="shadow-md ring-1 ring-border rounded-md w-[360px] py-1">
            {value.length > 0 && <SearchItems onSelect={handleSelectOption} />}
            <CommandPrimitive.Empty className="select-none px-2 py-3 text-center text-sm text-muted-foreground">
              {t("no_results")}
            </CommandPrimitive.Empty>
          </CommandList>
        </div>
      </div>
    </CommandPrimitive>
  );
  return isWide ? (
    command
  ) : (
    <Popover
      open={open}
      onOpenChange={(v) => {
        // Mobile: activate the heavy search context as soon as the popover
        // opens, so the index begins loading while the user is moving to
        // the input. See the desktop onFocus handler above.
        if (v) activate();
        setOpen(v);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={buttonRef}
          variant="ghost"
          role="button"
          aria-label={t("search")}
          className="text-secondary-foreground w-[28px] "
          onBlur={handleBlur}
        >
          <SearchIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[360px] p-0"
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
