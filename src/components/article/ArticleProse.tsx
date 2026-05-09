import { FC, PropsWithChildren } from "react";
import { proseClasses } from "./proseClasses";

// Drop-in primitives for hand-written long-form JSX so it matches the
// markdown rendering in ArticleScreen. If a page authors directly in
// React (e.g. documentation with embedded interactive bits), use these
// instead of bare <h2>/<p>/<ul>; markdown-rendered articles continue to
// go through ArticleScreen's react-markdown component overrides, which
// pull from the same `proseClasses` strings.

export const ArticleH2: FC<PropsWithChildren> = ({ children }) => (
  <h2 className={proseClasses.h2}>{children}</h2>
);

export const ArticleH3: FC<PropsWithChildren> = ({ children }) => (
  <h3 className={proseClasses.h3}>{children}</h3>
);

export const ArticleP: FC<PropsWithChildren> = ({ children }) => (
  <p className={proseClasses.p}>{children}</p>
);

export const ArticleUL: FC<PropsWithChildren> = ({ children }) => (
  <ul className={proseClasses.ul}>{children}</ul>
);

export const ArticleOL: FC<PropsWithChildren> = ({ children }) => (
  <ol className={proseClasses.ol}>{children}</ol>
);

export const ArticleLI: FC<PropsWithChildren> = ({ children }) => (
  <li className={proseClasses.li}>{children}</li>
);

export const ArticleStrong: FC<PropsWithChildren> = ({ children }) => (
  <strong className={proseClasses.strong}>{children}</strong>
);

export const ArticleHR: FC = () => <hr className={proseClasses.hr} />;
