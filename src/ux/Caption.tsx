export const Caption: React.FC<React.ComponentProps<"h2">> = ({
  className,
  ...props
}) => (
  <h2
    className={`text-2xl text-muted-foreground font-extrabold leading-tight text-center py-2 ${
      className || ""
    }`}
    {...props}
  />
);
