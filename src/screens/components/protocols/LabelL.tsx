import { FC, PropsWithChildren } from "react";

export const LabelL: FC<PropsWithChildren> = ({ children }) => (
  <div className="text-xl xl:text-2xl my-2 xl:my-4 font-semibold ml-2">
    {children}
  </div>
);
