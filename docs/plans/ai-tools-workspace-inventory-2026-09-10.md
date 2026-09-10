# AI tools inventory — 2026-09-10

Source audit, not a live-data certification. 228 registered tools; all six domains are included by Explorer. Parameters below are the CURRENT declarations, including defects documented in the implementation plan. A star means required; values/defaults are shown only when explicitly declared. Runtime defaults need separate reconciliation.

| Tool | Domain | Declared parameters | Discovery questions | Snapshot |
| --- | --- | --- | --- | --- |
| budgetVariance | fiscal | year: year = 2024 | 1 | Matches |
| budgetPersonnel | fiscal | None | 1 | Matches |
| budgetPersonnelByMinistry | fiscal | year: year = 2024 | 1 | Matches |
| budgetDocuments | fiscal | year: year = 2026 | 1 | Matches |
| budgetMinistries | fiscal | year: year = 2024 | 1 | Matches |
| budgetMunicipalTransfers | fiscal | year: year = 2024 | 1 | Matches |
| budgetCapitalByMunicipality | fiscal | year: year = 2025 | 1 | Matches |
| budgetInvestmentPayments | fiscal | None | 1 | Matches |
| waterServices | indicators | None | 1 | Matches |
| nationalResults | elections | election: election | 1 | Matches |
| presidentialResults | elections | cycle: cycle [2001, 2006, 2011, 2016, 2021]; round: count [1, 2]; place: place; oblast: oblast; candidate: person | 1 | Matches |
| regionWinners | elections | election: election; geography: metric = oblast [oblast, mir] | 1 | Matches |
| parliamentSeats | elections | election: election | 1 | Matches |
| seatsHistory | elections | years: count; n: count | 1 | Matches |
| partyResult | elections | party*: party; election: election | 1 | Matches |
| candidateResult | elections | name*: person; election: election | 1 | Matches |
| machineVoteShare | elections | election: election | 1 | Matches |
| turnout | elections | election: election | 1 | Matches |
| compareElections | elections | a*: election; b: election | 1 | Matches |
| machineVoteSeries | elections | n: count = 7; years: count | 1 | Matches |
| turnoutSeries | elections | n: count = 7; years: count | 1 | Matches |
| partyTimeline | elections | party*: party | 1 | Matches |
| pollAccuracy | elections | None | 1 | Matches |
| agencyProfile | elections | agency*: metric | 1 | Matches |
| latestPolls | elections | None | 1 | Matches |
| latestPresidentialPoll | elections | None | 0 | DRIFT |
| agencyPolls | elections | agency*: metric | 1 | Matches |
| agencyAccuracyHistory | elections | agency*: metric | 1 | Matches |
| accuracyTrend | elections | None | 1 | Matches |
| regionBreakdown | elections | party*: party; election: election; geography: metric = oblast [oblast, mir] | 1 | Matches |
| municipalityBreakdown | elections | party*: party; oblast*: oblast; election: election | 1 | Matches |
| municipalityWinners | elections | oblast*: oblast; election: election | 1 | Matches |
| settlementWinners | elections | place*: place; election: election | 1 | Matches |
| sectionWinners | elections | place*: place; election: election | 1 | Matches |
| sectionResults | elections | section*: metric; election: election | 1 | Matches |
| sectionHistory | elections | section*: metric | 1 | Matches |
| sectionRiskHistory | elections | section*: metric | 1 | Matches |
| settlementResults | elections | place*: place; election: election | 1 | Matches |
| settlementHistory | elections | place*: place; years: count; n: count | 1 | Matches |
| municipalityResults | elections | metric: metric [turnout]; party: party; place*: place; election: election | 1 | DRIFT |
| municipalityHistory | elections | place*: place; years: count; n: count | 1 | Matches |
| regionResults | elections | metric: metric [turnout]; party: party; oblast*: oblast; election: election | 1 | DRIFT |
| regionResultsTrend | elections | oblast*: oblast; years: count; n: count | 1 | Matches |
| settlementBreakdown | elections | party*: party; place*: place; election: election | 1 | Matches |
| electionAnomalies | elections | election: election | 1 | Matches |
| flashMemoryByParty | elections | election: election | 1 | Matches |
| machineVoteByParty | elections | election: election | 1 | Matches |
| wastedVotesByParty | elections | election: election | 1 | Matches |
| recountByParty | elections | election: election | 1 | Matches |
| regionHistory | elections | oblast*: oblast | 1 | Matches |
| voteTransitions | elections | party: party; election: election; direction: metric [in, out] | 1 | Matches |
| localCouncilVoteShare | local | cycle: cycle | 1 | Matches |
| localMayorsWon | local | cycle: cycle | 1 | Matches |
| localCouncilTrend | local | None | 1 | Matches |
| localVoteFlows | local | None | 1 | Matches |
| localPrevoteFlow | local | None | 1 | Matches |
| localPlaceTrend | local | place*: place | 1 | Matches |
| localMayorsTrend | local | None | 1 | Matches |
| localOblastMayors | local | place*: oblast; cycle: cycle | 1 | Matches |
| localMunicipality | local | place*: place; cycle: cycle | 1 | Matches |
| localMayorRace | local | place*: place; cycle: cycle | 1 | Matches |
| localMayorSections | local | place*: place; cycle: cycle | 1 | Matches |
| localMayorHistory | local | place*: place | 1 | Matches |
| localSubMayors | local | place*: place | 1 | Matches |
| localCouncil | local | place*: place; cycle: cycle | 1 | Matches |
| chmiEvents | local | place: place | 1 | Matches |
| budgetOverview | fiscal | year: year | 1 | Matches |
| ngoOverview | fiscal | None | 1 | Matches |
| ngoTopFunded | fiscal | None | 1 | Matches |
| ngoConflictAwarders | fiscal | None | 1 | Matches |
| ngoRiskSignals | fiscal | None | 1 | Matches |
| ngoBySignal | fiscal | code: text | 1 | Matches |
| budgetTrend | fiscal | None | 1 | Matches |
| institutionMaintenance | fiscal | institution: metric | 1 | Matches |
| simulateTaxChange | fiscal | change*: metric | 1 | Matches |
| budgetByFunction | fiscal | year: year | 1 | Matches |
| budgetFunction | fiscal | category*: metric; year: year | 1 | Matches |
| nzokBudget | fiscal | year: year | 1 | Matches |
| judiciaryBudget | fiscal | year: year | 1 | Matches |
| judiciaryCaseload | indicators | year: year | 1 | Matches |
| riverbedCleaning | fiscal | None | 1 | Matches |
| judiciaryWorkload | indicators | year: year | 1 | Matches |
| judiciaryCourtLoad | indicators | year: year; court: text | 1 | Matches |
| judiciaryDeclarations | people | None | 1 | Matches |
| defenseSpending | fiscal | None | 1 | Matches |
| armsExports | fiscal | None | 1 | Matches |
| defenseProgram | fiscal | None | 1 | Matches |
| defenseReadiness | indicators | None | 1 | Matches |
| securityRoadSafety | indicators | None | 1 | Matches |
| transportSpending | fiscal | None | 1 | Matches |
| transportEuFunds | fiscal | None | 1 | Matches |
| railSubsidy | fiscal | None | 1 | Matches |
| socialSpending | fiscal | None | 1 | Matches |
| socialBenefits | fiscal | None | 1 | Matches |
| socialPovertyImpact | indicators | None | 1 | Matches |
| mrrbSpending | fiscal | None | 1 | Matches |
| cohesionAbsorption | fiscal | None | 1 | Matches |
| regionalInvestment | indicators | None | 1 | Matches |
| environmentSpending | fiscal | None | 1 | Matches |
| environmentFunds | fiscal | None | 1 | Matches |
| wasteRecycling | indicators | None | 1 | Matches |
| defensePeerCompare | indicators | None | 1 | Matches |
| generationMix | indicators | None | 1 | Matches |
| electricityPrices | indicators | None | 1 | Matches |
| gasPrices | indicators | None | 1 | Matches |
| powerPlants | indicators | None | 1 | Matches |
| nzokDrugs | fiscal | count: count | 1 | Matches |
| nzokDrugGrowth | fiscal | None | 1 | Matches |
| nzokHospitals | fiscal | count: count | 1 | Matches |
| nzokActivities | fiscal | count: count | 1 | Matches |
| nzokDrugSavings | fiscal | count: count | 1 | Matches |
| nzokHospitalScorecard | fiscal | hospital: text | 1 | Matches |
| nzokPathwayHospitals | fiscal | procedure: text; count: count | 1 | Matches |
| nzokPublicPrivate | fiscal | None | 1 | Matches |
| nzokPrivateHospitals | fiscal | filter: text; count: count | 1 | Matches |
| nzokDrugMolecule | fiscal | inn: text; count: count | 1 | Matches |
| procurementTotals | fiscal | None | 1 | Matches |
| topContractors | fiscal | count: count | 1 | Matches |
| procurementAppeals | fiscal | count: count; awarder: metric | 1 | Matches |
| contractSearch | fiscal | company: person; year: year | 1 | Matches |
| procurementRedFlags | fiscal | None | 1 | Matches |
| procurementDebarred | fiscal | None | 1 | Matches |
| procurementSingleBidSectors | fiscal | None | 1 | Matches |
| mpProcurement | fiscal | person: person | 1 | Matches |
| awarderProcurement | fiscal | org: metric | 1 | Matches |
| procurementNormalcy | fiscal | key: text | 1 | Matches |
| roadsSpending | fiscal | None | 1 | Matches |
| openTenders | fiscal | query: metric; topic: metric; year: year; org: metric | 1 | Matches |
| tenderLookup | fiscal | unp: metric | 1 | Matches |
| openCalls | fiscal | audience: metric; query: text | 1 | Matches |
| fundsOverview | fiscal | None | 1 | Matches |
| projectLifecycle | fiscal | project: text | 1 | Matches |
| subsidiesOverview | fiscal | year: year | 1 | Matches |
| subsidiesByScheme | fiscal | year: year | 1 | Matches |
| subsidiesForEntity | fiscal | company: person | 1 | Matches |
| cultureOverview | fiscal | None | 1 | Matches |
| topCultureGrantees | fiscal | None | 1 | Matches |
| filmSubsidyForProducer | fiscal | company*: metric | 1 | Matches |
| cultureGrantSuccess | fiscal | None | 1 | Matches |
| cultureCommissions | fiscal | None | 1 | Matches |
| cultureMunicipal | fiscal | None | 1 | Matches |
| revenueBreakdown | fiscal | category: metric; year: year | 1 | Matches |
| exciseRegister | fiscal | category: metric | 1 | Matches |
| exciseWarehouses | fiscal | place: place; category: metric | 1 | Matches |
| fundsProjects | fiscal | None | 1 | Matches |
| municipalFiscalRanking | fiscal | year*: year; count: count; metric*: metric [commitments, expense_obligations, arrears] | 1 | Matches |
| municipalTransfers | fiscal | year: year | 1 | Matches |
| govDebt | fiscal | None | 1 | Matches |
| noiFunds | fiscal | None | 1 | Matches |
| noiPensionDistribution | fiscal | None | 1 | Matches |
| noiPensionByOblast | fiscal | None | 1 | Matches |
| noiPensionSeries | fiscal | None | 1 | Matches |
| kfnFunds | fiscal | count: count | 1 | Matches |
| budgetExecution | fiscal | series: metric | 1 | Matches |
| ministryBudget | fiscal | ministry*: metric | 1 | Matches |
| investmentProjects | fiscal | oblast: oblast | 1 | Matches |
| personProfile | people | name: person | 1 | Matches |
| personConnections | people | name: person | 1 | Matches |
| personWealth | people | name: person | 1 | Matches |
| governments | people | None | 1 | Matches |
| mpAssetsTop | people | None | 1 | Matches |
| mpConnectionsTop | people | None | 1 | Matches |
| mpAssetsByParty | people | None | 1 | Matches |
| mpConnectionsByParty | people | None | 1 | Matches |
| officialsAssetsTop | people | category: metric | 1 | Matches |
| financingOverview | people | None | 1 | Matches |
| partyFinance | people | party*: party; election: election | 1 | Matches |
| companyConnections | people | company*: person | 1 | Matches |
| macroIndicator | indicators | indicator: indicator; n: count; year: year | 56 | Matches |
| fdiFlows | indicators | None | 1 | Matches |
| macroOverview | indicators | None | 1 | Matches |
| macroByCategory | indicators | category: indicator | 1 | Matches |
| euComparison | indicators | indicator*: indicator | 1 | Matches |
| subnationalIndicator | indicators | place*: place; indicator: indicator; year: year | 1 | Matches |
| schoolMatura | indicators | school*: person | 1 | Matches |
| rankPlaces | indicators | indicator*: indicator; n: count | 1 | Matches |
| regionIndicator | indicators | oblast*: oblast; indicator: indicator; year: year | 1 | Matches |
| transparencyScore | indicators | place*: place | 1 | Matches |
| localTaxes | indicators | place*: place | 1 | Matches |
| landUse | indicators | oblast: oblast | 1 | Matches |
| priceIndex | indicators | oblast: oblast | 1 | Matches |
| settlementPrices | indicators | place*: place; product: metric | 1 | Matches |
| localDeals | indicators | place: place; product: metric | 1 | Matches |
| productPrice | indicators | product*: metric | 1 | Matches |
| cheapestChains | indicators | place: place | 1 | Matches |
| priceRanking | indicators | metric: metric; n: count | 1 | Matches |
| basketAffordability | indicators | oblast: oblast | 1 | Matches |
| basketVsInflation | indicators | None | 1 | Matches |
| euFoodPriceLevels | indicators | None | 1 | Matches |
| fuelPrices | indicators | None | 1 | Matches |
| chainProfile | indicators | chain*: text | 1 | Matches |
| governanceProfile | place | place*: place; year: year | 1 | Matches |
| comparePlaces | place | a*: place; b*: place | 1 | Matches |
| census | place | place*: place | 1 | Matches |
| procurementBySettlement | place | place*: place | 1 | Matches |
| myAreaAlerts | place | place*: place | 1 | Matches |
| placeEuProjects | place | place*: place | 1 | Matches |
| procurementByOblast | place | oblast*: oblast | 1 | Matches |
| airQuality | place | place*: place | 1 | Matches |
| graoPopulation | place | place*: place | 1 | Matches |
| councilResolutions | place | place*: place | 1 | Matches |
| problemSections | elections | election: election | 1 | Matches |
| romaVoteTrend | elections | years: count; n: count | 1 | Matches |
| riskIndex | elections | election: election | 1 | Matches |
| riskScore | elections | election: election | 1 | Matches |
| riskClusters | elections | election: election | 1 | Matches |
| clusterPersistence | elections | None | 1 | Matches |
| benfordAnomalies | elections | election: election | 1 | Matches |
| wastedVotes | elections | election: election | 1 | Matches |
| wastedVotesTrend | elections | years: count; n: count | 1 | Matches |
| suspiciousSettlements | elections | election: election | 1 | Matches |
| diasporaVote | elections | election: election | 1 | Matches |
| diasporaVoteTrend | elections | years: count; n: count | 1 | Matches |
| voterPersistence | elections | election: election | 1 | Matches |
| partyDemographics | elections | party*: party; election: election | 1 | Matches |
| demographicCleavages | elections | election: election | 1 | Matches |
| mpLoyalty | people | ns: count | 1 | Matches |
| mpAttendance | people | ns: count | 1 | Matches |
| factionCohesion | people | ns: count | 1 | Matches |
| mpVotingProfile | people | name*: person; ns: count | 1 | Matches |
| mpSimilarity | people | name*: person; ns: count | 1 | Matches |
| voteSearch | people | query: metric; ns: count | 1 | Matches |
| partyMps | people | party*: party | 1 | Matches |
| schoolScores | indicators | place*: place; subject: indicator | 1 | Matches |
| administrationOverview | fiscal | None | 1 | Matches |
| digitalSkills | fiscal | None | 1 | Matches |
| tourismSeasonality | indicators | None | 1 | Matches |
| tourismSourceMarkets | indicators | None | 1 | Matches |

## Undeclared direct argument reads requiring classification

This conservative scan inspects each registered run function. It does not follow helper calls, computed keys or destructured aliases. Many entries are compatibility aliases or internal clarification pins; do not expose every entry as a user control. The budget factory reads `year` conditionally, so its no-year variants are false positives.

- **budgetPersonnel**: year
- **budgetInvestmentPayments**: year
- **candidateResult**: partyNum
- **agencyPolls**: years, n
- **municipalityBreakdown**: place
- **municipalityWinners**: place
- **regionResults**: place
- **regionResultsTrend**: place
- **localSubMayors**: cycle
- **judiciaryCourtLoad**: query
- **nzokHospitalScorecard**: name
- **nzokPathwayHospitals**: pathway, name
- **nzokPrivateHospitals**: mode
- **contractSearch**: eik, count
- **awarderProcurement**: place
- **procurementNormalcy**: contract, id
- **openTenders**: place, subject, metric, unp
- **tenderLookup**: query, subject, metric
- **openCalls**: metric
- **subsidiesForEntity**: person, eik
- **filmSubsidyForProducer**: metric
- **revenueBreakdown**: metric
- **exciseRegister**: metric
- **exciseWarehouses**: metric
- **budgetExecution**: indicator
- **ministryBudget**: place
- **personProfile**: person
- **personConnections**: person
- **personWealth**: person
- **companyConnections**: eik
- **macroByCategory**: indicator
- **euComparison**: metric
- **schoolMatura**: place, query
- **procurementByOblast**: place
- **schoolScores**: indicator

## SQL-only instruments

These 59 questions are available in the SQL catalogue and explicitly unavailable in chat. Link to their data-browser workflow; do not run them through runTool.

- **top-contractors**: Which companies hold the largest awarded contract value in this corpus
- **companies-by-all-public-money**: Who received the most across contracts, farm subsidies, EU funds and Interreg combined
- **contractors-ranked-and-scoped**: The leaderboard the /procurement/contractors page draws, for one time window
- **top-awarders**: Which public bodies award the most money
- **where-a-buyer-sits**: The settlement, município and oblast a contracting authority is seated in
- **biggest-tenders**: The largest procedures put out to tender, by forecast value
- **forecast-vs-actual**: How the announced value compares with what was eventually awarded
- **one-buyer-s-procurement-profile**: What a single authority buys, from whom, and how competitively
- **single-bidder-contracts**: The largest contracts where only one company bid
- **riskiest-buyers**: Authorities whose contracts fire the most red flags, A–F
- **appeals-and-how-they-ended**: Recent КЗК complaints against procurement decisions
- **find-a-person**: One name across every people dataset the project holds
- **a-person-s-declared-wealth-by-year**: What one official declared, year by year, and how it moved
- **money-declared-abroad**: Which officials declare bank or investment holdings outside Bulgaria
- **who-owns-a-company**: The current cap table for one EIK, as percentages
- **officers-of-a-company**: Directors, managers and owners on record for one EIK
- **politically-connected-companies**: Firms linked to an MP or official, and the public money they hold
- **companies-registered-in-a-place**: Which firms are seated in one settlement, ranked by public money
- **municipal-financial-health**: The quarterly indicators that decide whether a município is in fiscal difficulty
- **what-is-open-right-now**: Calls a reader could apply to today, with their deadlines
- **base-rates-for-a-procedure**: How many projects a procedure disbursed to before, and the median grant
- **clean-delivery-register**: EU-funded contracts that finished with no financial correction
- **interreg-operations**: Cross-border projects and their budgets — the corpus ИСУН does not hold
- **bulgarian-interreg-partners**: Which Bulgarian organisations take part, and for how much
- **voting-twins**: Which MPs vote together most often
- **party-cohesion**: How often a party's MPs vote the same way
- **a-day-in-the-chamber**: Every vote taken on one sitting day, with its outcome
- **what-the-health-fund-pays-each-hospital**: Per-hospital payments for inpatient care
- **medicine-reimbursement-by-molecule**: What the fund spends per active substance
- **contractors-in-the-registry**: Procurement winners matched to their Commerce Registry record — the ЕИК link
- **both-contracts-and-eu-funds**: Companies that take public contracts AND EU grants
- **officials-who-hold-company-roles**: Declaring officials who also appear in the Commerce Registry — the person link
- **hospitals-that-also-buy**: Facilities the health fund pays which are themselves contracting authorities
- **name-search**: One name across companies, officers and contractors at once
- **unified-search**: Companies, officers and non-registry contractors in one ranked feed
- **what-changed-recently**: New rows across every dataset, newest first
- **corpus-sizes**: How big each table is — an estimate, stale until autovacuum runs
- **budget-programme-detail**: What are a ministry’s programmes, plan and execution?
- **budget-functional-explorer**: What are budget expenditures by function?
- **budget-monthly-series**: How do monthly budget revenues and expenditure change?
- **budget-municipality-detail**: What are municipal transfers and budget execution?
- **school-directory**: Which schools have published matura results?
- **school-results**: Matura results by school
- **school-context**: School educational context
- **agriculture-payments**: Agricultural subsidies by beneficiary
- **agriculture-schemes**: Agricultural schemes by year
- **ngo-funding**: Nonprofit organisation funding
- **retail-products**: Products in retail price monitoring
- **retail-current**: Latest observed retail prices
- **declaration-income**: Declared income
- **declaration-obligations**: Declared obligations
- **declaration-changes**: Declaration changes
- **council-resolutions**: Municipal council resolutions
- **council-votes**: Municipal council votes
- **legislation-register**: Parliamentary bills
- **magistrate-assets**: Magistrate declared assets
- **water-operators**: Water operators and geographical coverage
- **administrative-services**: Administrative services register
- **excise-warehouses**: Tax warehouse register
