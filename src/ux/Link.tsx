import { FC, HTMLProps } from 'react';

export const Link: FC<HTMLProps<HTMLAnchorElement>> = ({
  className,
  ...props
}) => <a className={`link link-hover ${className || ''}`} {...props} />;
