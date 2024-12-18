import { Command as CommandPrimitive } from "cmdk";
import {
  FC,
  useState,
  useRef,
  useCallback,
  type KeyboardEvent,
  useContext,
} from "react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchItems } from "./SearchItems";
import { Button } from "@/components/ui/button";
import { SearchCheckIcon } from "lucide-react";
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
  const [open, setOpen] = useState<boolean>(false);
  const [value, setValue] = useState("");
  const { arrowDown, arrowUp, selected, setSearchTerm } =
    useContext(SearchContext);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleValueChange = useCallback(
    (value: string) => {
      setSearchTerm(value);
      setValue(value);
      //setIsOpen(!!value && value.length > 2);
    },
    [setSearchTerm],
  );
  const isSmall = useMediaQueryMatch("sm");
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
      setTimeout(() => {
        inputRef?.current?.blur();
      }, 0);
    },
    [navigate],
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
    },

    [arrowDown, arrowUp, handleSelectOption, handleValueChange, open, selected],
  );

  const handleBlur = useCallback(() => {
    setOpen(false);
  }, []);

  return !isSmall ? (
    <CommandPrimitive onKeyDown={handleKeyDown}>
      <div>
        <CommandInput
          ref={inputRef}
          value={value}
          onValueChange={handleValueChange}
          onBlur={handleBlur}
          onFocus={() => setOpen(true)}
          placeholder="search..."
          className="text-base"
        />
      </div>
      <div className="relative mt-1">
        <div
          className={cn(
            "animate-in fade-in-0 zoom-in-95 absolute top-0 z-10 w-full rounded-xl bg-white outline-none",
            open ? "block" : "hidden",
          )}
        >
          <CommandList className="rounded-lg ring-1 ring-slate-200">
            {value.length > 0 && <SearchItems onSelect={handleSelectOption} />}

            <CommandPrimitive.Empty className="select-none rounded-sm px-2 py-3 text-center text-sm">
              {t("no_results")}
            </CommandPrimitive.Empty>
          </CommandList>
        </div>
      </div>
    </CommandPrimitive>
  ) : (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          //role="combobox"
          aria-expanded={open}
          className="w-[28px]"
          onBlur={handleBlur}
        >
          <SearchCheckIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        autoFocus={true}
        className="w-[200px] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (
            e.target instanceof Element &&
            e.target.hasAttribute("cmdk-input")
          ) {
            e.preventDefault();
          }
        }}
      >
        <CommandPrimitive onKeyDown={handleKeyDown}>
          <Command>
            <CommandInput
              value={value}
              placeholder="Search framework..."
              onValueChange={handleValueChange}
            />

            <CommandEmpty>No framework found.</CommandEmpty>
            <CommandList>
              {value.length > 0 && (
                <SearchItems onSelect={handleSelectOption} />
              )}
            </CommandList>
          </Command>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
};

export const Search: FC = () => (
  <SearchContextProvider>
    <SearchInternal />
  </SearchContextProvider>
);
