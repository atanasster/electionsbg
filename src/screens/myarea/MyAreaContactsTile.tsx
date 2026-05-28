// Municipal contacts tile — phone / email / website / address for the
// município office. Tap-targets are tel: / mailto: links so a phone user
// can call directly. Auto-hides until the update-municipal-contacts
// scrape populates the data file.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Phone, Mail, Globe, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useMunicipalContacts } from "@/data/officials/useMunicipalContacts";

type Props = {
  obshtina: string;
};

// Total channels we track. Any future channel (e.g. социална мрежа)
// would bump this and the completeness badge updates automatically.
const TOTAL_CHANNELS = 4;

export const MyAreaContactsTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { contact } = useMunicipalContacts(obshtina);

  if (!contact) return null;

  const rows: Array<{
    icon: typeof Phone;
    label: string;
    value: string;
    href?: string;
  }> = [];
  if (contact.phone) {
    rows.push({
      icon: Phone,
      label: t("my_area_contacts_phone"),
      value: contact.phone,
      href: `tel:${contact.phone.replace(/\s+/g, "")}`,
    });
  }
  if (contact.email) {
    rows.push({
      icon: Mail,
      label: t("my_area_contacts_email"),
      value: contact.email,
      href: `mailto:${contact.email}`,
    });
  }
  if (contact.website) {
    rows.push({
      icon: Globe,
      label: t("my_area_contacts_website"),
      value: contact.website.replace(/^https?:\/\//, ""),
      href: contact.website,
    });
  }
  if (contact.address) {
    rows.push({
      icon: MapPin,
      label: t("my_area_contacts_address"),
      value: contact.address,
    });
  }
  if (rows.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Phone className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_contacts_title")}
        </h2>
        {/* Completeness badge — "X от Y канала" / "X of Y channels".
            Gives the user a quick signal that we may not have every
            contact channel even when the tile renders. */}
        <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded border text-muted-foreground">
          {rows.length}
          {lang === "bg"
            ? ` от ${TOTAL_CHANNELS} канала`
            : ` of ${TOTAL_CHANNELS}`}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <div key={i} className="flex items-start gap-2 text-sm">
              <Icon className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {r.label}
                </div>
                {r.href ? (
                  <a
                    href={r.href}
                    target={r.href.startsWith("http") ? "_blank" : undefined}
                    rel={
                      r.href.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                    className="text-primary underline break-all"
                  >
                    {r.value}
                  </a>
                ) : (
                  <span>{r.value}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
