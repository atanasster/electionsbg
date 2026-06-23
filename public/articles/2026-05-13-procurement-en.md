---
keywords:
  - public procurement
  - АОП
  - data.egov.bg
  - state contracts
  - MP-connected companies
  - Energy Supply EOOD
  - CAIS EOP
  - Audit Office
  - Commerce Registry
  - conflict of interest
  - 52nd National Assembly
---
# The state's money: the new public-procurement module and MPs' business connections

For years, citizens have been able to easily check how a given MP voted, which district they were elected from, and what assets they declared. What was missing until now — without manually downloading thousands of files from [data.egov.bg](https://data.egov.bg/) and painstakingly cross-referencing them with [politicians' business graph](/connections) — was the other side of the coin: which companies the state pays, and which of them are connected to Members of Parliament.

The new [Public Procurement](/procurement) module fills exactly that gap. The database currently holds **244,556 contracts and amendments** from **3,369 awarders** to **23,123 contractors**, covering **2011 through 2026**.

For the period after 19.04.2026 (the term of the 52nd National Assembly), 3 MPs are recorded whose connected companies received a combined €213K. Across the full 15-year period the figures show: **50 MPs are connected to 53 companies that have won contracts worth over €590M**.

## 1. What is the module?

This is a public register that integrates public-procurement data with politicians' business histories, in order to surface the contractor companies that have a Member of Parliament involved.

- **The contracts**: Pulled directly from the [Public Procurement Agency (АОП)](https://app.eop.bg/) via the [open-data portal](https://data.egov.bg/organisation/about/aop). They include every contract, amendment, and award decision under the Public Procurement Act.
- **The connected persons**: The information comes from declarations to the [Audit Office](https://register.cacbg.bg/) and the [Commerce Registry](https://portal.registryagency.bg/CR/en/Verifications/Verifications).
- **Legal framework**: It is important to clarify that this is not a list of accusations. Bulgarian law forbids sitting MPs from holding management roles, but does not prevent them from owning shares or having had a business in the past.
- **Limitations**: Out of scope are contracts below the Public Procurement Act thresholds, in-house awards, and contracts with foreign companies.

## 2. Sources and data refresh

| Source | Content | Format | Refresh |
|---|---|---|---|
| [data.egov.bg (АОП)](https://data.egov.bg/organisation/about/aop) | Contracts, amendments, decisions | JSON / CSV | Fortnightly |
| [register.cacbg.bg](https://register.cacbg.bg/) | MPs' shareholdings | XML | Annually |
| [data.egov.bg (Commerce Registry)](https://data.egov.bg/) | Managers, partners, owners | Bulk JSON | Daily |

## 3. Functionality on the national dashboard

The [Public Procurement](/#procurement) section has two main panels:

- **Top MPs by connected procurement**: A ranking of MPs (current or former) whose companies have received the most funds. The filter is based on the contract date, which explains the presence of former politicians whose businesses continue to work with the state.
- **Top contractors**: The companies with the largest contracts; those connected to politicians are clearly marked with a badge.

## 4. What the [/procurement](/procurement) page offers

The main dashboard gives a quick overview through four key indicators:

- **Contracts**: Total count, split into primary contracts and amendments.
- **Total value**: The amount in euros (converted at the BNB rate).
- **Contractors**: Number of unique companies and state awarding institutions.
- **MP-connected**: Number of politicians, connected companies, and the total amount of their contracts.

**Sankey diagram**: Visualizes the flow of money: Awarder → Contractor → MP. The thickness of the lines shows the size of the amount, and a slider allows filtering by value for better readability.

## 5. A worked example: [Energy Supply EOOD](/company/175392783)

This is an example of high data reliability — the company was officially declared by the MP himself, which rules out an error from a name match.

- **Person**: [Georgi Kadiev](/candidate/mp-3410) (MP in the 40th, 42nd, and 43rd National Assembly), who declared a shareholding.
- **Company**: [Energy Supply EOOD](/company/175392783) (EIK 175392783) — an energy supplier.
- **Statistics**: 22 contracts worth a total of €7.06M. The largest amounts come from the [National Railway Infrastructure Company (НКЖИ)](https://app.eop.bg/) (BGN 1.51M), the Naval Forces Command in Varna (BGN 1.25M), and the Council of Ministers (BGN 910K).
- **Reliability**: Maximum — the link is confirmed through a declaration, not through a mere name match.

## 6. How do we ensure the links are accurate?

Not every "Ivan Ivanov" in the Commerce Registry is the MP "Ivan Ivanov". That is why every link carries a reliability label:

- **High**: The MP declared the company themselves, or there is a match on several signals (electoral district, party colleagues).
- **Medium**: There is a name match in the Commerce Registry, but additional confirmation is missing. These cases are marked with a yellow badge, to point the user toward a careful check.

**Automatic noise filtering (False Positives)**

To ensure the system does not create false dependencies, we apply three levels of software filtering:

- **Candidates without a mandate**: The parliament's public database often contains records of people who were on electoral lists but were not elected. The system automatically excludes such profiles when there is no evidence of a real mandate (current or past), an official photo, or a filed declaration.
- **Mass name matches**: When a given name appears in dozens of unrelated companies (often professional company registrars or notaries) and none of those links is backed by a declaration to the Audit Office, the system automatically rejects the whole set. This is how we avoid "staining" a profile with random namesakes.
- **Manually confirmed duplicates**: We maintain a dedicated exception list (white/black list). It contains confirmed cases of different individuals with identical names (for example, a well-known corporate manager and a politician), to prevent them from being wrongly linked on the platform.

## 7. The purpose of the project

The module does not aim to take over the functions of investigative bodies, but to make public data understandable. It allows citizens and journalists to see in a matter of minutes whether political interests stand behind a given state contract. Most of the data reflects lawful business relationships, but transparency is the only way for the important exceptions to become visible to the public.
