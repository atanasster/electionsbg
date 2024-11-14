import { Link } from "@/ux/Link";

export const Footer = () => (
  <footer className="footer flex p-4 bg-muted text-primary justify-between invisible lg:visible">
    <div className="text-sm sm:text-center whitespace-nowrap flex">
      © {new Date().getFullYear()} . All Rights Reserved.
    </div>
    <ul className="flex flex-wrap items-center mt-3 text-md sm:mt-0">
      <li>
        <Link href="#" aria-label="about" className="mx-2">
          About
        </Link>
      </li>
      <li>
        <Link href="/privacy" aria-label="privacy" className="mx-2">
          Privacy Policy
        </Link>
      </li>
      <li>
        <Link href="#" aria-label="contact" className="mx-2">
          Contact
        </Link>
      </li>
    </ul>
  </footer>
);
