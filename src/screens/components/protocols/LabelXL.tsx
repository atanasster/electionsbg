import { FC, PropsWithChildren } from "react";

export const LabelXL: FC<PropsWithChildren> = ({ children }) => (
  <div className="text-2xl xl:text-4xl my-2 xl:my-4 mr-2 font-bold">
    {children}
  </div>
);
