// Сметна палата party financing register. Separate from the per-MP
// declarations registry on register.cacbg.bg — this is the central party
// finance disclosure index on the Court of Audit's main site. Cadence is
// weekly during election cycles, monthly otherwise; we use weekly always
// since over-reporting is benign (silence is the worse failure).

import type { WatchSource, Fingerprint } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PAGE = "https://www.bulnao.government.bg/bg/Финансиране-на-партии";

export const smetnaPalata: WatchSource = {
  id: "smetna_palata",
  label: "Сметна палата party financing",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty party financing page");
    // Strip volatile chrome (session ids, build assets) before hashing.
    const stable = html
      .replace(/\?_=\d+/g, "")
      .replace(/<input[^>]*name="__RequestVerificationToken"[^>]*>/g, "")
      .replace(/<script[\s\S]*?<\/script>/g, "");
    const value = sha256Short(stable);
    return {
      value,
      detail: `index hash ${value}`,
      meta: { bytes: stable.length },
    };
  },
};
