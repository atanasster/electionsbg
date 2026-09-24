# Cheapest EU VPS ≥2 vCPU / ≥4 GB RAM / ≥40 GB disk — verified from primary pages (late 2026)

All prices read from the providers' **own** sites / own APIs. EUR→USD at **1 EUR = 1.16 USD** (as requested).
"ex-VAT" = net / HT. "inc-VAT" uses the VAT the provider's page applied to a Bulgarian visitor (20% BG),
except OVHcloud where only the IE subsidiary (23%) is API-verifiable.

## Main table

| Provider | Plan name | vCPU | RAM | Disk | Price EUR/mo (ex-VAT / net) | inc-VAT EUR/mo | IPv4 | Traffic | USD/mo @1.16 (ex-VAT) |
|---|---|---|---|---|---|---|---|---|---|
| **netcup** | VPS Lite 1 G12s | 2 vCore x86 (shared) | 4 GB | 80 GB SSD | **€4.10** (6-mo term) | €4.92 (20% BG) | Included (€0.00); IPv6-only −€0.60 | Soft cap: >100 Mbps 24 h avg → throttle to 100 Mbps; 500 Mbps NIC; no overage fee | **$4.76** |
| **netcup** (alt, cancellable) | VPS 500 G12 | 2 vCore x86 | 4 GB DDR5 ECC | 128 GB NVMe | €4.96 (12-mo term) / €5.72 (hourly, 0-mo term) | €5.95 / €6.86 | Included; IPv6-only −€0.60 | Soft cap: >2 TB/24 h avg → throttle to 200 Mbit/s; 2.5 Gbit/s NIC | $5.75 / $6.64 |
| **Contabo** | Cloud VPS 4 | 4 vCPU (shared) | 8 GB | 100 GB SSD | **€5.50** (1-mo term) / €4.68 (12-mo) / €4.40 (24-mo prepay) | €6.60 / €5.62 / €5.28 | Included (1 IPv4 + IPv6); extra IPs paid | "Unlimited" (FUP), 200 Mbit/s port; throttling at provider discretion, no overage fee | **$6.38** / $5.43 / $5.10 |
| **Contabo** (alt) | Storage VPS 10 | 2 vCPU | 4 GB | 300 GB SSD | €4.40 (24-mo prepay) | €5.28 | Included | Unlimited (FUP), 200 Mbit/s | $5.10 |
| **OVHcloud** | VPS-1 2027 | 2 vCores (shared) | 4 GB | 40 GB NVMe | **€4.49** (monthly) / €3.81 (12-mo prepay) / €4.26 (6-mo) | €5.39 (BG 20%, derived) / €5.52 (IE 23%, verified) | Included — delivered with IPv4 /32 + IPv6 /128 | Unlimited, 500 Mbps; APAC quota 500 GB/mo then 10 Mbps; no overage fee | **$5.21** / $4.42 |
| **Scaleway** | DEV1-M | 3 shared vCPU (AMD EPYC 7281) | 4 GB | 40 GB dynamic local SSD *(see flag)* | **€14.74** + **€3.65** IPv4 = €18.39 | €22.07 (BG 20%) | **Extra**: flexible IPv4 €0.005/h ≈ €3.65/mo; IPv6 free | Egress included (no egress fees), 300 Mbps | **$17.10** compute / **$21.33** with IPv4 |
| **OVHcloud bare metal** | RISE-1 (Eco/Rise) | 6c/12t Intel Xeon-E 2386G | 32–128 GB | 2×512 GB – 4×3.84 TB | €56.99 + **€56.99 one-time install** | €70.10 (BG 20%, derived) | Included | Guaranteed 1 Gbps unlimited in EU/NA | $66.11 + $66.11 install |
| **Kimsufi / OVH Eco** | KS-3 | 4c/8t Xeon-E3 1245 v5 | 64 GB | 2×2 TB | €26.99 (install fee not stated on the Kimsufi listing — unverified) | €32.39 (BG 20%, derived) | Included | Public 300 Mbps | $31.31 |

### Cheapest qualifying pick
**netcup VPS Lite 1 G12s — €4.10/mo ex-VAT ($4.76)** is the cheapest option that meets 2 vCPU / 4 GB / ≥40 GB,
followed by **OVHcloud VPS-1 2027 at €4.49/mo ex-VAT ($5.21)**, then **Contabo Cloud VPS 4 at €5.50/mo
($6.38) monthly / €4.40 ($5.10) on 24-month prepay**. Scaleway is by far the most expensive of the four
for this shape (~3× netcup).

## One line per provider — Cloudflare / datacenter-IP reputation

> **No provider publishes a Cloudflare-reputation statement, and Cloudflare publishes no per-ASN verdict
> list. The following is therefore grounded in the objective ASN data below plus Cloudflare's own docs, and
> the relative ranking is flagged unverified.**

| Provider | ASN | PeeringDB network type | Assessment |
|---|---|---|---|
| **netcup** | AS197540 | *Content* (Europe-only scope) | Non-residential hosting ASN → Cloudflare treats it as datacenter. Smallest footprint of the four, so the least accumulated blocklist history — but expect the same generic challenge risk as any VPS. *Relative ranking unverified.* |
| **Contabo** | AS51167 | *Content* (global scope, selective peering) | Non-residential hosting ASN → datacenter treatment. Global budget-hosting footprint; community reports put it among the more frequently challenged/abused ranges. *Community reports, not primary — unverified.* |
| **OVHcloud / Kimsufi** | AS16276 | *Content* (global, 10–20 Tbps, open peering) | Non-residential hosting ASN → datacenter treatment. Largest network of the four and the most widely present in third-party blocklists; expect aggressive Cloudflare challenges on well-protected targets. *Blocklist breadth unverified.* |
| **Scaleway** | AS12876 | *Content* (Europe-only) | Non-residential hosting ASN → datacenter treatment. Mid-sized European cloud range; same generic challenge risk. *Relative ranking unverified.* |

Grounding: Cloudflare generates bot scores from heuristics + an ML model whose v8 release explicitly
"increased weight on network level traffic characteristics" (i.e. network/ASN-level signals), and the
`Heuristics` engine assigns score 1 on high-confidence automation fingerprints — so a fresh datacenter IP
running headless Chromium on a schedule is scored as automated unless the operator allows it. **Whether any
specific target site challenges these ranges depends on that site's Cloudflare plan and rules and cannot be
verified from the providers' pages.** All four ASNs are registered in PeeringDB as type **Content**
(hosting), not Cable/DSL/ISP — i.e. none is residential.

## Explicit flags — could NOT be verified from a primary source / caveats

1. **netcup VAT is inconsistent across its own pages.** The `/en/server/vps` overview cards print
   "(incl. 19% VAT)" while the product pages for a Bulgarian visitor print "incl. 20% VAT" and the footer
   still says "Price incl. 19% VAT." The 20% figures (€4.92 / €5.95) are the localised ones; ex-VAT is
   derived as gross ÷ 1.20. netcup itself states VAT varies by the customer's country.
2. **OVHcloud has no Bulgarian subsidiary** — `api.ovh.com/.../catalog/public/vps?ovhSubsidiary=BG`
   returns `{"class":"Client::BadRequest","message":"invalid ovhSubsidiary"}`. Only IE (23% VAT) is
   verifiable; the BG 20% inc-VAT column is a derived figure.
3. **Scaleway DEV1-M storage.** The datasheet lists DEV1 as "Dynamic local: 1 x SSD" and the instance API
   gives a 40 GB volume constraint for DEV1-M, but Scaleway's pricing-page legal notice says
   *"Storage (local, block) and attached public IPv4 addresses are excluded"* from list prices. Whether the
   40 GB local SSD is inside the €14.74 could **not** be conclusively verified — if it is not, add
   Block Storage 5K at €0.000130/GB/h (≈ €3.80/mo for 40 GB). Also note DEV1-M is *exactly* 40 GB, no slack.
4. **Contabo publishes two different figures for the same plan.** The `/en/vps/` product cards render
   Cloud VPS 4 at "€7.86 / €6.55 net", while `/en/pricing/` and the order configurator give €5.28 inc-VAT /
   €4.40 ex-VAT for the 24-month term. I used the configurator + pricing page (they agree with each other
   and with the JSON-LD `lowPrice` 5.50 ex-VAT monthly). The card figure is unexplained.
5. **Cloudflare IP reputation** — see caveat above; no primary source exists, ranking flagged unverified.
6. **Kimsufi KS-3 one-time installation fee** is not shown on the Kimsufi listing; OVH's Rise page does show
   installation fee = one month. KS install fee unverified.

## Provider-specific answers to the brief

### 1. netcup
- **Current lineup is Generation 12.** Names: `VPS 500/1000/2000/4000/8000 G12` (x86) and the cheaper
  `vServer Lite` line `VPS pico G11s, VPS nano G11s, VPS Lite 1–4 G12s`. G11 is "generally no longer
  available for purchase" (netcup FAQ).
- **Cheapest tier meeting the spec: VPS Lite 1 G12s** — 2 vCore / 4 GB / 80 GB SSD, **€4.92/mo incl. 20% VAT
  (€4.10 ex-VAT)**, set-up fee **€0.00**.
- **Billing period / commitment:** Lite 1 G12s has **minimum contract period 6 months, billing period
  6 months** — the "monthly only" label on the overview means *no prepay discount option*, not
  month-to-month. The regular VPS G12 line is **12-month term, or hourly billing**; the hourly option has
  *"no minimum contract terms or notice periods"* and costs +€0.91/mo on VPS 500 G12 (€6.86 incl. VAT).
  So **yes, netcup offers a monthly-cancellable option, but only on the regular VPS G12 line, not on Lite.**
- **Setup fee:** €0.00 on both products inspected.
- **VAT:** prices vary by country of residence; 19% default, 20% for BG.
- **Traffic:** "Traffic included" / flatrate. Lite 1 G12s throttles to 100 Mbps if the 24 h average exceeds
  100 Mbps; VPS 500 G12 throttles to 200 Mbit/s above a 2 TB/24 h average. No overage charge.
- **IPv4:** included (option "IPv4 + IPv6 Connectivity €0.00"); IPv6-only or vLAN-only saves €0.60/mo.
- **ARM64:** netcup's ARM VPS line is `VPS 1000/2000/3000 ARM G11` (6/10/12 vCore, 8/16/24 GB, 256/512/768 GB
  NVMe) from €7.77/mo incl. 19% VAT — but the page states **"Our VPS ARM are currently sold out."**
  ARM64 is a *VPS* product (KVM), not a dedicated server; it is not purchasable right now.

### 2. Contabo
- **Current lineup:** Core VPS `Cloud VPS 4/6/8/12/16/18` (SSD, shared CPU), Performance
  `Cloud VPS Plus 4–18` (AMD EPYC, NVMe), `Cloud VDS S–XXL`, `Storage VPS 10/20/30/40/50`, dedicated servers.
- **"Cloud VPS 10 SSD" does not exist** — there is no Cloud VPS 10 in the 2026 lineup. The nearest thing is
  **Storage VPS 10** (2 vCPU / 4 GB / 300 GB SSD), also €5.28 inc-VAT for the 24-month term. Storage VPS 20
  is marked SOLD OUT.
- **Cheapest with ≥4 GB: Cloud VPS 4** — 4 vCPU / 8 GB / 100 GB SSD, 200 Mbit/s.
  **1 month €5.50/mo ex-VAT; 12 months €4.68/mo; 24 months €4.40/mo (€105.60 prepaid today).**
  Inc. 20% BG VAT: €6.60 / €5.62 / **€5.28**.
- **Setup fee: none** ("No Setup Fee", One-Time €0.00 in the order summary).
- **Terms:** minimum initial contract 1 month; minimum following contract = the initial length; the
  advertised low price is explicitly *"the effective monthly rate for a 24-month subscription"*. Cancellation
  notice: none (pre-paid) or 4 weeks (post-paid). So **the €4.40/€5.28 headline requires a 24-month prepay**.
- **Traffic:** *"Every Cloud VPS plan comes with unlimited inbound and outbound data transfer… Fair usage
  policies apply"*; provider reserves the right to throttle. No overage charge. Ports 200 Mbit/s → 1 Gbit/s.
- **IPv4:** *"Dedicated IPv4 and IPv6 addresses come with every plan"* — free; extra IPs purchasable.
- **2024–2025 price context:** a struck-through previous price is rendered on the cards (Cloud VPS 4:
  €9.18 → €7.86 inc-VAT), i.e. the current 24-month price is *below* the prior list price.

### 3. OVHcloud / Kimsufi
- **(a) OVHcloud VPS — current range is "VPS 2027":** `VPS-1 … VPS-4`.
  **VPS-1 2027: 2 vCores / 4 GB / 40 GB NVMe SSD.** Ex-VAT: **€4.49/mo** default monthly, **€3.81/mo**
  on 12-month prepay, €4.26/mo on 6-month. Inc-VAT (IE 23%): €5.52. Installation fee **€0.00**
  (the catalog's "Installation fees" and "Upgrade fees" pricings are both €0.00).
  There is no "VLE-1" in the new range; the legacy VLE/VPS Value 1-2-40 (1 vCPU/2 GB) is €5.80 ex-VAT but
  doesn't meet 4 GB. The older 2026 range still lists VPS-1 2026 at €6.49/mo ex-VAT.
- **(b) Kimsufi still exists.** `kimsufi.com` is live in 2026, branded **"KIMSUFI BY OVHCLOUD" / "KIMSUFI
  PAR OVHCLOUD"**, © OVH SAS 1999-2026, and now presents OVHcloud's **Eco dedicated ranges (KS, SYS, RISE)**
  rather than a separate product line. OVH's own docs still carry a "Kimsufi, So You Start, and Rise —
  Get to Know the OVHcloud Control Panel" guide. So: not retired as a brand, but it is now a skin over the
  OVHcloud Eco dedicated catalogue.
- **(c) Cheapest bare metal:** **Kimsufi KS-3** (4c/8t Xeon-E3 1245 v5, 64 GB, 2×2 TB, 300 Mbps) at
  **€26.99 HT/mo**. Cheapest OVH **Rise** server is **RISE-1** at **€56.99 ex-VAT/mo + €56.99 one-time
  installation fee**.
- **Traffic:** "Unlimited traffic" on all VPS, VPS-1 at 500 Mbps public bandwidth; only the Asia-Pacific
  regions carry a quota (500 GB/mo for VPS-1, then capped at 10 Mbps). No overage fee in Europe.
- **IPv4:** *"All of our VPS solutions are delivered with a pre-configured IPv4 (/32) and IPv6 (/128)"* —
  included; up to 16 additional IPs available as a paid option.

### 4. Scaleway
- **Current instance families (2026 price list):** Development (`STARDUST1-S`, `DEV1-S/M/L/XL`),
  General Purpose (`PLAY2-*`, `BASIC2-A*` ARM Ampere, `BASIC3-X*`, `STANDARD3-X*`, `POP2-*`, `GP1-*`),
  Compute Optimized (`PRO2-*`, `COMPUTE3-*`, `POP2-HC-*`), Memory Optimized (`MEMORY3-*`, `POP2-HM-*`),
  Network Optimized (`POP2-HN-*`).
- **COPARM1 is retired.** Scaleway's own "Historical Instances offering" page lists `COPARM1` (ARM Ampere
  Altra Max M128-30) as End of Life / "no longer available". ARM is now sold as **`BASIC2-A2C-4G`**
  (2 vCPU / 4 GB, arm64) at **€16.79/mo** — **not** the cheapest.
- **Cheapest instance with ≥4 GB: `DEV1-M`** — 3 shared vCPU / 4 GB / 40 GB dynamic local SSD,
  **€14.74/mo ex-VAT** (€0.0202/h). Next: BASIC2-A2C-4G €16.79, PLAY2-NANO €20.10, BASIC3-X2C-4G €28.80.
  The genuinely cheapest instance is `STARDUST1-S` at €0.43/mo but it is 1 vCPU / 1 GB — below spec.
- **VAT: all Scaleway website prices exclude tax.** Scaleway's billing FAQ: *"Prices announced on our
  website exclude all taxes… we are required to charge VAT on all orders made by European individual
  customers (B2C)."*
- **Storage:** DEV1/STARDUST use **dynamic local SSD**; PLAY2/BASIC/POP2/PRO2/GP1 use **Block Storage**
  (Block 5K €0.000130/GB/h ≈ €0.0949/GB/mo; Block 15K €0.000177/GB/h). Local storage inclusion in the
  instance price is flagged unverified (see flags).
- **IPv4 vs IPv6:** **IPv4 is an extra charge, IPv6 is free.** Per-instance list prices *"include egress and
  IPv6 addresses… attached public IPv4 addresses are excluded."* Scaleway's IP-billing doc: a flexible IPv4
  is created by default with an instance and *"is billed separately at an hourly rate"*; flexible IPv6
  *"are often free"*. Network pricing page: **IPv4 €0.005/h ≈ €3.65/mo**. Creating the instance without a
  flexible IPv4 (IPv6-only) avoids that charge. Note Scaleway no longer advertises a distinct "IPv6-only
  discount" line — the saving is simply the omitted IPv4 fee.
- **Traffic:** egress included in list prices, no egress fees; DEV1-M public bandwidth 300 Mbps.

## Primary URLs fetched / used

**netcup**
- https://www.netcup.com/en/server/vps
- https://www.netcup.com/en/server/vps-lite
- https://www.netcup.com/en/server/vps/vps-lite-1-g12s-iv-6m
- https://www.netcup.com/en/server/vps/vps-500-g12-iv-12m
- https://www.netcup.com/en/server/arm-server

**Contabo**
- https://contabo.com/en/vps/
- https://contabo.com/en/pricing/
- https://contabo.com/en/vps/cloud-vps-core-4 (order configurator, term/billing/setup/IPv4)

**OVHcloud / Kimsufi**
- https://www.ovhcloud.com/en-ie/vps/
- https://www.ovhcloud.com/en-ie/vps/vps-ip/
- https://www.ovhcloud.com/en-ie/bare-metal/rise/
- https://www.kimsufi.com/en/ and https://www.kimsufi.com/fr/
- https://api.ovh.com/v1/order/catalog/public/vps?ovhSubsidiary=IE (OVH's own public catalog API — plan
  specs "VPS 2 vCPU 4 GB RAM 40 GB disk", all pricing modes, €0.00 installation fee, 23% IE tax)

**Scaleway**
- https://www.scaleway.com/en/pricing/virtual-instances/
- https://www.scaleway.com/en/pricing/network/ (Additional IP / flexible IPv4 €0.005/h)
- https://www.scaleway.com/en/pricing/storage/ (Block Storage €0.000130/GB/h)
- https://www.scaleway.com/en/development-instances/
- https://www.scaleway.com/en/docs/billing/faq/ ("Prices announced on our website exclude all taxes")
- https://www.scaleway.com/en/docs/ipam/reference-content/understanding-ip-billing/
- Scaleway docs repo (primary): `instances/reference-content/historical-offers.mdx` (COPARM1 EOL),
  `instances/reference-content/instances-datasheet.mdx` (DEV1/PLAY2/BASIC2 specs)
- https://api.scaleway.com/instance/v1/zones/fr-par-1/products/servers (Scaleway's own unauthenticated
  product API — monthly/hourly prices, vCPU, RAM, arch, volume constraints)

**Cloudflare / ASN data**
- https://developers.cloudflare.com/bots/concepts/bot-score/
- https://developers.cloudflare.com/bots/reference/machine-learning-models/
- https://www.peeringdb.com/api/net?asn=197540 / 51167 / 16276 / 12876 (network type = Content for all four)
