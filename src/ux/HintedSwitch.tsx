import { FC } from "react";
import { Hint } from "./Hint";
import { Switch } from "@/components/ui/switch";
import { useTouch } from "./TouchProvider";
import { Label } from "@/components/ui/label";

export const HintedSwitch: FC<{
  value: boolean;
  hint: string;
  label: string;
  setValue: (value: boolean) => void;
}> = ({ value, setValue, hint, label }) => {
  const isTouch = useTouch();
  const row = (
    <div className="flex items-center space-x-2 pb-4 justify-end">
      <Switch
        id={label}
        checked={value}
        onCheckedChange={(value) => setValue(value)}
      />
      <Label
        className="text-secondary-foreground"
        htmlFor={isTouch ? undefined : label}
      >
        {label}
      </Label>
    </div>
  );
  return isTouch ? row : <Hint text={hint}>{row}</Hint>;
};
