export const Title: React.FC<React.ComponentProps<'h2'>> = ({
  className,
  ...props
}) => (
  <h2
    className={`md:text-4xl text-xl font-bold md:font-extrabold py-4 md:py-12 sm:py-4 ${
      className || ''
    }`}
    {...props}
  />
);
