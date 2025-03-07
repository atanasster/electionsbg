import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { FC, PropsWithChildren, ReactNode } from "react";

export const ProtocolCard: FC<
  PropsWithChildren<{ icon: ReactNode; title: string; className?: string }>
> = ({ title, icon, children, className }) => (
  <Card className="max-h-64">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className={cn("text-md font-medium", className)}>
        {title}
      </CardTitle>
      {icon}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);
