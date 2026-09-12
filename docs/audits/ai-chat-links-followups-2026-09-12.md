# AI chat links and follow-up audit — 2026-09-12

Scope: all 229 registered chat tools, their site destinations, and follow-up policy. This is a source-level audit against the application routes, with unit and mocked tool integration checks; it is not a live browser execution of every tool.

## Findings and repairs

- Product answers inherited the indicators domain fallback. Resolved productPrice answers now link to /product/:slug; the exact Lavazza title is covered by a tool integration regression.
- Domain-wide fallback links could send unrelated subjects to generic indicators, fiscal, or people pages. Every registered tool now has an explicit subject destination or requires a resolved entity. Unknown tools and clarification responses emit no site link.
- Resolved entity links are preferred without a second unrelated category link. Aggregate hospital rankings retain their NHIF overview plus a labeled leading-hospital drilldown. Products, chains, people, subsidy recipients, procurement awarders, project dossiers, municipalities, and councils retain their subject where the response exposes its identifier.
- Parliamentary election provenance, local/presidential cycles, supported budget fiscal years, and tender search topic/year are retained. Tender year uses the browser's pscope parameter.
- Follow-ups previously inferred relevance from catalog subcategories. Explicit reviewed subject groups now control general suggestions. Parameterized answers suppress generic suggestions that would drop their filter. Specific product answers no longer suggest national shopping rankings.
- Existing party/place/company continuations retain their entity. Public-person profile, wealth and connection responses now expose a dedicated hidden public-person ID; name-only business portfolios omit unsupported continuations. related person prompts use that ID. Generic continuations cannot substitute example people, companies, places, or free-text entities from the catalog.

Presidential place links use the site's canonical route builder. Sofia's three-MIR aggregate has no equivalent presidential place page, so its link is omitted. Governance locators fold Sofia MIR codes to the canonical city page.

The follow-up review and repair findings are documented in `CODE_REVIEW_REPORT.md`.

## Reading the inventory

The destination column is the default with no resolved facts. Entity-specific deep links override these defaults. “Requires resolved context” means no generic link is emitted. The continuation column lists eligible general catalog question IDs; execution may omit them for scoped answers or when a single election is unavailable. Parliamentary provenance overrides catalog sample dates; compatible trend windows survive serialized chip execution. Explicit context-preserving party/place/company/person continuations are handled separately in followUps.

Tests enumerate the independent tool registry so adding an unmapped capability fails. Default destinations are checked against registered routes. Focused fixtures cover exact product identity, other entity destinations, historical scopes, clarification, unknown tools, and continuation context.

## Validation

- `npx vitest run --config ai/tests/vitest.chatLinks.config.ts`: 21 files, 2,188 tests passed (all chat app unit tests plus link, product, person, presidential and product-router checks).
- `node --import tsx ai/render/links.harness.ts`: all deep-link regression cases passed.
- `npm run build:ai`: typecheck and production bundle passed. Vite reports runtime font resolution and a large-chunk warning.
- Targeted ESLint on changed AI files: passed.
- Full network-backed golden regression suite and live deployment were not run.

## Tool inventory

| Tool | Default destination | Eligible general continuations |
| --- | --- | --- |
| budgetVariance | /budget/deviations | budgetTrend, budgetByFunction, budgetOverview |
| budgetPersonnel | /budget/personnel | budgetPersonnelByMinistry |
| budgetPersonnelByMinistry | /budget/personnel | budgetPersonnel |
| budgetDocuments | /budget/law | None |
| budgetMinistries | /budget/ministries | None |
| budgetMunicipalTransfers | /budget/municipal | municipalTransfers, municipalFiscalRanking |
| budgetCapitalByMunicipality | /budget/municipal/capital | budgetInvestmentPayments |
| budgetInvestmentPayments | /budget/municipal/investments | budgetCapitalByMunicipality |
| waterServices | /water | None |
| nationalResults | /parties | parliamentSeats, seatsHistory |
| presidentialResults | Requires resolved context | None |
| regionWinners | /regions | None |
| parliamentSeats | /parliament | nationalResults, seatsHistory |
| seatsHistory | /parliament | nationalResults, parliamentSeats |
| partyResult | Requires resolved context | None |
| candidateResult | Requires resolved context | None |
| machineVoteShare | /parliamentary | machineVoteSeries, turnoutSeries, turnout |
| turnout | /parliamentary | machineVoteShare, machineVoteSeries, turnoutSeries |
| compareElections | /parties | None |
| machineVoteSeries | /parliamentary | machineVoteShare, turnoutSeries, turnout |
| turnoutSeries | /parliamentary | machineVoteShare, machineVoteSeries, turnout |
| partyTimeline | Requires resolved context | None |
| pollAccuracy | /polls | latestPolls, accuracyTrend |
| agencyProfile | /polls | None |
| latestPolls | /polls | pollAccuracy, accuracyTrend |
| latestPresidentialPoll | /polls | None |
| agencyPolls | /polls | None |
| agencyAccuracyHistory | /polls | None |
| accuracyTrend | /polls | pollAccuracy, latestPolls |
| regionBreakdown | Requires resolved context | None |
| municipalityBreakdown | Requires resolved context | None |
| municipalityWinners | /regions | None |
| settlementWinners | /regions | None |
| sectionWinners | /regions | None |
| sectionResults | Requires resolved context | None |
| sectionHistory | Requires resolved context | None |
| sectionRiskHistory | Requires resolved context | None |
| settlementResults | Requires resolved context | None |
| settlementHistory | Requires resolved context | None |
| municipalityResults | /regions | None |
| municipalityHistory | /regions | None |
| regionResults | /regions | None |
| regionResultsTrend | /regions | None |
| settlementBreakdown | Requires resolved context | None |
| electionAnomalies | /risk-score | None |
| flashMemoryByParty | /flash-memory | None |
| machineVoteByParty | /parliamentary | None |
| wastedVotesByParty | /risk-analysis | wastedVotes, wastedVotesTrend |
| recountByParty | /recount | None |
| regionHistory | /regions | None |
| voteTransitions | /parliamentary | None |
| localCouncilVoteShare | /local/2023_10_29_mi | None |
| localMayorsWon | /local/2023_10_29_mi | None |
| localCouncilTrend | /local/2023_10_29_mi | None |
| localVoteFlows | /local/2023_10_29_mi | None |
| localPrevoteFlow | /local/2023_10_29_mi | None |
| localPlaceTrend | /local/2023_10_29_mi | None |
| localMayorsTrend | /local/2023_10_29_mi | None |
| localOblastMayors | /local/2023_10_29_mi | None |
| localMunicipality | /local/2023_10_29_mi | None |
| localMayorRace | /local/2023_10_29_mi | None |
| localMayorSections | /local/2023_10_29_mi | None |
| localMayorHistory | /local/2023_10_29_mi | None |
| localSubMayors | /local/2023_10_29_mi | None |
| localCouncil | /local/2023_10_29_mi | None |
| chmiEvents | /local/chmi | None |
| budgetOverview | /budget | budgetTrend, budgetByFunction, budgetVariance |
| ngoOverview | /procurement/ngos | ngoTopFunded, ngoConflictAwarders, ngoRiskSignals |
| ngoTopFunded | /procurement/ngos | ngoOverview, ngoConflictAwarders, ngoRiskSignals |
| ngoConflictAwarders | /procurement/ngos | ngoOverview, ngoTopFunded, ngoRiskSignals |
| ngoRiskSignals | /procurement/ngos | ngoOverview, ngoTopFunded, ngoConflictAwarders |
| ngoBySignal | /procurement/ngos | ngoOverview, ngoTopFunded, ngoConflictAwarders, ngoRiskSignals |
| budgetTrend | /budget | budgetByFunction, budgetOverview, budgetVariance |
| institutionMaintenance | /budget/ministries | budgetPersonnel, budgetPersonnelByMinistry |
| simulateTaxChange | /budget/simulator | None |
| budgetByFunction | /budget/functional | budgetTrend, budgetOverview, budgetVariance |
| budgetFunction | /budget/functional | None |
| nzokBudget | /awarder/121858220 | None |
| judiciaryBudget | /judiciary | judiciaryCaseload, judiciaryWorkload |
| judiciaryCaseload | /judiciary | judiciaryBudget, judiciaryWorkload |
| riverbedCleaning | /water | None |
| judiciaryWorkload | /judiciary | judiciaryBudget, judiciaryCaseload |
| judiciaryCourtLoad | /judiciary | judiciaryBudget, judiciaryCaseload, judiciaryWorkload |
| judiciaryDeclarations | /judiciary/magistrates | None |
| defenseSpending | /defense | defensePeerCompare, armsExports, defenseReadiness |
| armsExports | /defense | defenseSpending, defensePeerCompare, defenseReadiness |
| defenseProgram | /defense | None |
| defenseReadiness | /defense | defenseSpending, defensePeerCompare, armsExports |
| securityRoadSafety | /sector/security | None |
| transportSpending | /sector/transport | transportEuFunds, railSubsidy |
| transportEuFunds | /sector/transport | transportSpending, railSubsidy |
| railSubsidy | /sector/transport | transportSpending, transportEuFunds |
| socialSpending | /sector/social | socialPovertyImpact, socialBenefits |
| socialBenefits | /sector/social | socialPovertyImpact, socialSpending |
| socialPovertyImpact | /sector/social | socialSpending, socialBenefits |
| mrrbSpending | /sector/regional | None |
| cohesionAbsorption | /sector/regional | None |
| regionalInvestment | /sector/regional | None |
| environmentSpending | /sector/environment | environmentFunds |
| environmentFunds | /sector/environment | environmentSpending |
| wasteRecycling | /sector/environment | None |
| defensePeerCompare | /defense | defenseSpending, armsExports, defenseReadiness |
| generationMix | /sector/energy | powerPlants |
| electricityPrices | /consumption/electricity | None |
| gasPrices | /consumption/gas | None |
| powerPlants | /sector/energy | generationMix |
| nzokDrugs | /awarder/121858220 | nzokDrugGrowth, nzokDrugSavings |
| nzokDrugGrowth | /awarder/121858220 | nzokDrugs, nzokDrugSavings |
| nzokHospitals | /awarder/121858220 | nzokPublicPrivate |
| nzokActivities | /awarder/121858220 | None |
| nzokDrugSavings | /awarder/121858220 | nzokDrugs, nzokDrugGrowth |
| nzokHospitalScorecard | /awarder/121858220 | None |
| nzokPathwayHospitals | /awarder/121858220 | None |
| nzokPublicPrivate | /awarder/121858220 | nzokHospitals |
| nzokPrivateHospitals | /awarder/121858220 | nzokHospitals, nzokPublicPrivate |
| nzokDrugMolecule | /awarder/121858220 | None |
| procurementTotals | /procurement | topContractors |
| topContractors | /procurement/contractors | procurementTotals |
| procurementAppeals | /procurement/appeals | None |
| contractSearch | /procurement/contracts | None |
| procurementRedFlags | /procurement/flags | procurementSingleBidSectors |
| procurementDebarred | /procurement/flags | None |
| procurementSingleBidSectors | /procurement/flags | procurementRedFlags |
| mpProcurement | /procurement/mps | None |
| awarderProcurement | /procurement/awarders | None |
| procurementNormalcy | /procurement/flags | procurementRedFlags, procurementSingleBidSectors |
| roadsSpending | /procurement/roads | None |
| openTenders | /procurement/tenders | None |
| tenderLookup | /procurement/tenders | None |
| openCalls | /funds/calls | None |
| fundsOverview | /funds | None |
| projectLifecycle | /procurement/projects | None |
| subsidiesOverview | /subsidies | subsidiesByScheme |
| subsidiesByScheme | /subsidies/schemes | subsidiesOverview |
| subsidiesForEntity | /subsidies/recipients | None |
| cultureOverview | /culture | topCultureGrantees, cultureGrantSuccess, cultureCommissions, cultureMunicipal |
| topCultureGrantees | /culture/films | cultureOverview, cultureGrantSuccess, cultureCommissions, cultureMunicipal |
| filmSubsidyForProducer | /culture/films | None |
| cultureGrantSuccess | /culture | cultureOverview, topCultureGrantees, cultureCommissions, cultureMunicipal |
| cultureCommissions | /culture | cultureOverview, topCultureGrantees, cultureGrantSuccess, cultureMunicipal |
| cultureMunicipal | /culture | cultureOverview, topCultureGrantees, cultureGrantSuccess, cultureCommissions |
| revenueBreakdown | /budget/revenue | None |
| exciseRegister | /customs/warehouses | None |
| exciseWarehouses | /customs/warehouses | None |
| fundsProjects | /funds | None |
| municipalFiscalRanking | /governance/municipal-finance | municipalTransfers, budgetMunicipalTransfers |
| municipalTransfers | /budget/municipal | municipalFiscalRanking, budgetMunicipalTransfers |
| govDebt | /indicators/fiscal | None |
| noiFunds | /pensions | None |
| noiPensionDistribution | /pensions | noiPensionByOblast, noiPensionSeries |
| noiPensionByOblast | /pensions | noiPensionDistribution, noiPensionSeries |
| noiPensionSeries | /pensions | noiPensionDistribution, noiPensionByOblast |
| kfnFunds | /pensions | None |
| budgetExecution | /budget/execution | budgetTrend, budgetByFunction, budgetOverview, budgetVariance |
| ministryBudget | /budget/ministries | None |
| investmentProjects | /budget/investments | None |
| personProfile | Requires resolved context | None |
| personConnections | /connections | None |
| personWealth | /governance/declarations | None |
| governments | /governments | None |
| mpAssetsTop | /mp-assets | mpAssetsByParty |
| mpConnectionsTop | /connections | None |
| mpAssetsByParty | /mp-assets | mpAssetsTop |
| mpConnectionsByParty | /connections | None |
| officialsAssetsTop | /governance/declarations | None |
| financingOverview | /financing | None |
| partyFinance | /financing | None |
| companyProfile | Requires resolved context | None |
| companyConnections | Requires resolved context | None |
| macroIndicator | /indicators | None |
| fdiFlows | /indicators/economy | None |
| macroOverview | /indicators | None |
| macroByCategory | /indicators | None |
| euComparison | /indicators/compare | None |
| subnationalIndicator | /governance | None |
| schoolMatura | Requires resolved context | None |
| rankPlaces | /governance | None |
| regionIndicator | /governance | None |
| transparencyScore | /governance | None |
| localTaxes | /governance | None |
| landUse | /sector/environment | None |
| priceIndex | /consumption/overview | basketVsInflation, euFoodPriceLevels |
| settlementPrices | /consumption | None |
| localDeals | /consumption/deals | None |
| productPrice | /consumption/products | None |
| cheapestChains | /consumption/chains | None |
| priceRanking | /consumption | None |
| basketAffordability | /consumption | None |
| basketVsInflation | /consumption/overview | euFoodPriceLevels |
| euFoodPriceLevels | /consumption/eu | basketVsInflation |
| fuelPrices | /consumption/fuel | None |
| chainProfile | /consumption/chains | None |
| governanceProfile | /governance | None |
| comparePlaces | /governance | None |
| census | /governance | None |
| procurementBySettlement | /procurement/by-settlement | None |
| myAreaAlerts | /governance | None |
| placeEuProjects | /funds/places | None |
| procurementByOblast | /procurement/by-settlement | None |
| airQuality | /governance | None |
| graoPopulation | /governance | None |
| councilResolutions | /council | None |
| problemSections | /risk-analysis | None |
| romaVoteTrend | /risk-analysis | None |
| riskIndex | /risk-analysis | None |
| riskScore | /risk-score | None |
| riskClusters | /risk-analysis | None |
| clusterPersistence | /risk-analysis | None |
| benfordAnomalies | /risk-analysis | None |
| wastedVotes | /risk-analysis | wastedVotesByParty, wastedVotesTrend |
| wastedVotesTrend | /reports/settlement/wasted-votes | wastedVotesByParty, wastedVotes |
| suspiciousSettlements | /risk-analysis | None |
| diasporaVote | /municipality/32 | diasporaVoteTrend |
| diasporaVoteTrend | /municipality/32 | diasporaVote |
| voterPersistence | /parliamentary | None |
| partyDemographics | /party-demographics | None |
| demographicCleavages | /party-demographics | None |
| mpLoyalty | /votes | mpAttendance, factionCohesion |
| mpAttendance | /parliament/attendance | mpLoyalty, factionCohesion |
| factionCohesion | /parliament/cohesion | mpLoyalty, mpAttendance |
| mpVotingProfile | Requires resolved context | None |
| mpSimilarity | Requires resolved context | None |
| voteSearch | /votes | None |
| partyMps | /parliament | None |
| schoolScores | /education | None |
| administrationOverview | /sector/administration | digitalSkills |
| digitalSkills | /sector/administration | administrationOverview |
| tourismSeasonality | /sector/tourism | tourismSourceMarkets |
| tourismSourceMarkets | /sector/tourism | tourismSeasonality |

Additional validation: `npm run ai:test:non-ai` passed (743 passing cases; 207 predeclared expected failures). Final targeted ESLint and diff whitespace checks passed.

## Regression coverage before commit

- All 229 registered tools: exact default destinations locked to the reviewed inventory in `ai/render/fixtures/subject-destinations.json`, plus route validity and entity deep-link tests.
- Product fix and query preservation: `prices.product.test.ts`, `router.prices.test.ts`, bilingual starter contracts.
- Election context and series windows: `answerContext.test.ts` and `followups.test.ts`, including conflicting arguments, multi-election provenance, and serialized n/years continuations.
- Person identity: profile/portfolio integration and bilingual empty/populated wealth and connection responses in `person.test.ts` and `person.identity.test.ts`.
- Hospital ranking, historical budget/tender scope, ministry, settlement price and party breakdown links: `links.subject.test.ts` and the link harness.
- Presidential place identity and unsupported Sofia aggregate omission: `presidential.test.ts`.

Final coverage gate: 21 files, 2,188 tests passed; AI type checking and targeted lint passed. Production code is unchanged since the successful AI build recorded above.
