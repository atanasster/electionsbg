# Budget execution-report discovery — 2026-05-25

Playwright sweep of 7 BG ministry budget sections that static HTML scraping misses. Candidates ranked by keyword + recency. The operator picks the right file, saves to `raw_data/budget/exec-<adminId>-<fy>.pdf`, and adds a manual-pdf entry in `scripts/budget/fetch_sources.ts:EXECUTION_REPORTS`.

## МОН — Ministry of Education
adminId: `admin-ministerstvoto-na-obrazovanieto-i-naukata`
startUrl: https://www.mon.bg/mon/byudzheti-i-finansovi-otcheti/

_no candidates surfaced_

## МРРБ — Regional Development
adminId: `admin-ministerstvoto-na-regionalnoto-razvitie-i-blagoustroystvoto`
startUrl: https://www.mrrb.bg/bg/byudzhet/

| Score | URL | Text | Reasons |
|------:|-----|------|---------|
| 5 | https://www.mrrb.bg/static/media/ups/categories/attachments/%D0%94%D0%BE%D0%BA%D0%BB%D0%B0%D0%B4%20%D0%B7%D0%B0%20%D0%BD%D0%B0%D0%BF%D1%80%D0%B5%D0%B4%D1%8A%D0%BA%D0%B0%20%D0%BF%D0%BE%20%D0%B8%D0%B7%D0%BF%D1%8A%D0%BB%D0%BD%D0%B5%D0%BD%D0%B8%D0%B5%D1%82%D0%BE%20%D0%BD%D0%B0%20%D0%9D%D0%9F%D0%95%D0%95%D0%9C%D0%96%D0%A1%20%D0%BF%D1%80%D0%B5%D0%B7%20201743198f5e2b69b3556defc21a56e8bcb4.pdf | Доклад за напредъка по изпълнението на НПЕЕМЖС през 2017 | pdf, execution |
| 5 | https://www.mrrb.bg/static/media/ups/categories/attachments/%D0%94%D0%BE%D0%BA%D0%BB%D0%B0%D0%B4%20%20%D0%B7%D0%B0%20%D0%BD%D0%B0%D0%BF%D1%80%D0%B5%D0%B4%D1%8A%D0%BA%D0%B0%20%D0%BF%D0%BE%20%D0%B8%D0%B7%D0%BF%D1%8A%D0%BB%D0%BD%D0%B5%D0%BD%D0%B8%D0%B5%D1%82%D0%BE%20%D0%BD%D0%B0%20%D0%9D%D0%9F%D0%95%D0%95%D0%9C%D0%96%D0%A1%20%D0%BF%D1%80%D0%B5%D0%B7%202018%20%D0%B3.12ebc27be75406d742df286654858514.pdf | Доклад за напредъка по изпълнението на НПЕЕМЖС през 2018 г. | pdf, execution |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/EHMS%20bg851660224966129de08f17bb5edb2251.doc | Европейска харта за местното самоуправление | docx |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/EHMS%20report_BGd3e0043731f52420a16658d503a6e0dd.doc | Обяснителен доклад към Европейската харта за местното самоуправление ( | docx |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/Dopalnitelen%20protokol%20EHMSe4a57ac18854eac49499b5cf829f2b8e.docx | Допълнителен протокол към Хартата за правото на участие в делата на местната власт | docx |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/V_m_Explanatory%20Report%20Dop%20protokol%20EHMS%20bgefbd88b16ce086413c0fd83987084918.doc | Обяснителен доклад към Допълнителния протокол към Хартата за правото на участие в делата на местната власт | docx |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/monitoring%201996_bg0332692f0398b405efa167ebc6debb92.doc | Предварителен доклад за състоянието на демокрацията на местно и регионално равнище в България,1996 г. | docx |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/monitoring%201998_bg7d1eee66fa240c5fb9577fd1d884a253.doc | Доклад за състоянието на местното и регионално самоуправление в Република България, 1998 г. | docx |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/Preporaka%2045%201998%20BGd00e024fc775bb103141a0dfe0a63e38.doc | Препоръка 45 (1998) за състоянието на местното и регионално самоуправление в Република България | docx |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/Resolution%2066%20bgcb447e7d50e7264c2cf9e200df6ddc99.doc | Резолюция 66 (1998) за състоянието на местното и регионално самоуправление в Република България | docx |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/Monitoringov%20doklad%2021.09-bg_Whole8f76fd71712b76b40a9886707fc0985d.doc | Доклад „Местната и регионална демокрация в България“, 2011 г. | docx |
| 3 | https://www.mrrb.bg/static/media/ups/categories/attachments/REC-310-2011-Bulgaria_bg500adc23fc1c287ae610b35f07ccbcf7.doc | Препоръка 310 (2011) „Местната и регионална демокрация в България“ | docx |

## МТС — Transport
adminId: `admin-ministerstvoto-na-transporta-i-saobshteniyata`
startUrl: https://www.mtc.government.bg/bg/category/266

| Score | URL | Text | Reasons |
|------:|-----|------|---------|
| 11 | https://www.mtc.government.bg/sites/default/files/documents/2025-06/2024%20gfo%20vrb.zip | Годишни финансови отчети за 2024 г. на второстепенните разпоредители с бюджет към МТС | zip, otchet, budget, 2025 |
| 11 | https://www.mtc.government.bg/sites/default/files/documents/2024-08/gfo%202023%20vrb%201.zip | Годишни финансови отчети за 2023 г. на второстепенните разпоредители с бюджет към МТС -1 част | zip, otchet, budget, 2024 |
| 11 | https://www.mtc.government.bg/sites/default/files/documents/2024-08/scan%20gfo%202023%20vrb%202.zip | Годишни финансови отчети за 2023 г. на второстепенните разпоредители с бюджет към МТС - 2 част | zip, otchet, budget, 2024 |
| 10 | https://www.mtc.government.bg/sites/default/files/documents/2025-05/Otchet-Prih-Razh-MTS-2024_zp.pdf | Отчет за приходите и разходите на МТС за 2024 г. | pdf, otchet, 2025 |
| 6 | https://www.mtc.government.bg/sites/default/files/documents/2025-05/Balans-MTS-2024_zp.pdf | Баланс на МТС за 2024 г. | pdf, 2025 |
| 6 | https://www.mtc.government.bg/sites/default/files/documents/2025-05/OditenDoklad-0100116824-MTS-2024_zp.pdf | Одитен доклад № 0100116824 за заверка на ГФО на МТС за 2024 г. | pdf, 2025 |
| 6 | https://www.mtc.government.bg/sites/default/files/documents/2025-05/Pril-GFO-MTS-2024_zp.pdf | Приложение към ГФО на МТС за 2024 г. | pdf, 2025 |

## МК — Culture
adminId: `admin-ministerstvoto-na-kulturata`
startUrl: https://mc.government.bg/

| Score | URL | Text | Reasons |
|------:|-----|------|---------|
| 21 | https://mc.government.bg/wp-content/uploads/2023/03/80730_9345_1800_Otchet_31.12.2022.doc | ОТЧЕТ ЗА ИЗПЪЛНЕНИЕТО НА ПОЛИТИКИТЕ И ПРОГРАМИТЕ НА МИНИСТЕРСТВО НА КУЛТУРАТА КЪМ 31.12.2022 г. (27.03.2023) | docx, otchet, programme, execution, 2023, annual, canonical |
| 21 | https://mc.government.bg/wp-content/uploads/2023/03/80729_9344_1800_Otchet_31.12.2022.doc | ОТЧЕТ ЗА ИЗПЪЛНЕНИЕТО НА ПОЛИТИКИТЕ И ПРОГРАМИТЕ НА МИНИСТЕРСТВО НА КУЛТУРАТА КЪМ 31.12.2022 г. | docx, otchet, programme, execution, 2023, annual, canonical |
| 16 | https://mc.government.bg/wp-content/uploads/2025/12/84628_11270_Otchet_30.09.2025.xls | Изтегли | xlsx, otchet, 2025, canonical |
| 16 | https://mc.government.bg/wp-content/uploads/2025/12/84627_11261_Otchet_31.10.2025.xls | Изтегли | xlsx, otchet, 2025, canonical |
| 16 | https://mc.government.bg/wp-content/uploads/2025/12/84626_11260_Otchet_30.09.2025.xls | Изтегли | xlsx, otchet, 2025, canonical |
| 16 | https://mc.government.bg/wp-content/uploads/2025/09/84621_11169_Otchet_31.08.2025.xls | Изтегли | xlsx, otchet, 2025, canonical |
| 16 | https://mc.government.bg/wp-content/uploads/2025/08/84620_11152_Otchet_31.07.2025.xls | Изтегли | xlsx, otchet, 2025, canonical |
| 16 | https://mc.government.bg/wp-content/uploads/2025/08/84619_11087_Otchet_30.06.2025.xls | Изтегли | xlsx, otchet, 2025, canonical |
| 16 | https://mc.government.bg/wp-content/uploads/2025/06/84617_10944_Otchet_31.05.2025.xls | Изтегли | xlsx, otchet, 2025, canonical |
| 16 | https://mc.government.bg/wp-content/uploads/2025/05/84615_10909_Otchet_30.04.2025.xls | Изтегли | xlsx, otchet, 2025, canonical |
| 13 | https://mc.government.bg/wp-content/uploads/2025/09/84623_11173_Otchet20-budget20MK20-20programen20-2030.06.20252020-20rezume.docx | Изтегли | docx, otchet, programme, 2025 |
| 13 | https://mc.government.bg/wp-content/uploads/2025/09/84622_11172_Otchet20-budget20-20programen20kym2030.06.2025.docx | Изтегли | docx, otchet, programme, 2025 |

## МЕ — Energy
adminId: `admin-ministerstvoto-na-energetikata`
startUrl: https://www.me.government.bg/bg/budget

_no candidates surfaced_

## МС — Council of Ministers
adminId: `admin-ministerskiya-savet`
startUrl: https://www.government.bg/bg/administratsia/byudzhet/byudzhet-na-ms

| Score | URL | Text | Reasons |
|------:|-----|------|---------|
| 15 | https://www.government.bg/files/common/0300_Maket%20Otchet%20programi%20B.1-2026.xlsx | Отчет за изпълнението на бюджета с тримесечна информация за разходите по бюджетни програми по бюджета | xlsx, otchet, programme, budget, execution, 2026 |
| 12 | https://www.government.bg/files/common/B1_2026_04_0300.xls | Отчет за касовото изпълнение на бюджета | xlsx, otchet, budget, execution, 2026 |
| 12 | https://www.government.bg/files/common/B3_2026_01_0300.xls | Отчет за касово изпълнение на бюджета | xlsx, otchet, budget, execution, 2026 |
| 12 | https://www.government.bg/files/common/Cash-Flow-2026-I-0300.xls | Отчет за касовото изпълнение на бюджета, сметките за средствата от Европейския съюз и сметките за чуждите средства | xlsx, otchet, budget, execution, 2026 |
| 12 | https://www.government.bg/files/common/B1_2026_03_0300.xls | Отчет за касовото изпълнение на бюджета | xlsx, otchet, budget, execution, 2026 |
| 12 | https://www.government.bg/files/common/B1_2026_02_0300.xls | Отчет за касовото изпълнение на бюджета | xlsx, otchet, budget, execution, 2026 |
| 12 | https://www.government.bg/files/common/B1_2026_01_0300.xls | Отчет за касовото изпълнение на бюджета | xlsx, otchet, budget, execution, 2026 |
| 10 | https://www.government.bg/files/common/B1_2026_04_0300_33.xls | Отчет за касовото изпълнение на сметките на чуждите средства | xlsx, otchet, execution, 2026 |
| 10 | https://www.government.bg/files/common/B1_2026_04_0300_DES.xls | Отчет за касовото изпълнение на сметките на средствата от Европейския съюз - ДЕС | xlsx, otchet, execution, 2026 |
| 10 | https://www.government.bg/files/common/B1_2026_04_0300_KSF.xls | Отчет за касовото изпълнение на сметките на средствата от Европейския съюз – КСФ | xlsx, otchet, execution, 2026 |
| 10 | https://www.government.bg/files/common/B1_2026_04_0300_DMP.xls | Отчет за касовото изпълнение на сметките на средствата от Европейския съюз - ДМП | xlsx, otchet, execution, 2026 |
| 10 | https://www.government.bg/files/common/B3_2026_01_0300_33.xls | Отчет за касовото изпълнение на сметките на чуждите средства | xlsx, otchet, execution, 2026 |

## МВнР — Foreign Affairs
adminId: `admin-ministerstvoto-na-vanshnite-raboti`
startUrl: https://www.mfa.bg/bg/ministerstvo/dokumenti/otchetnost

| Score | URL | Text | Reasons |
|------:|-----|------|---------|
| 18 | https://www.mfa.bg/upload/104/1100-Otchet_programi-31_12_2017.xlsx | Програмен отчет на МВнР към 31.12.2017 г. | xlsx, otchet, programme, annual, canonical |
| 14 | https://www.mfa.bg/upload/141415/%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%B5%D0%BD%20%D0%BE%D1%82%D1%87%D0%B5%D1%82%2031.12.2025%20%D0%9C%D0%92%D0%BD%D0%A0.zip | Програмен отчет - четвърто тримесечие (31.12.2024 г.) | zip, otchet, programme, 2025, annual |
| 14 | https://www.mfa.bg/upload/42652/ProgramenOtchet01-062019-MVnR-2-2-.pdf | Доклад зи изпълнението на програмния бюджет на МВнР към полугодието на 2019 година | pdf, otchet, programme, budget, execution |
| 14 | https://www.mfa.bg/upload/35189/Otchet-Jan-June2018-1.pdf | Отчет за изпълнението на програмния бюджет на МВнР за първото полугодие на 2018 г. | pdf, otchet, programme, budget, execution |
| 14 | https://www.mfa.bg/upload/214/MFABudgetreport201112Final.pdf | Отчет за изпълнението на бюджета на Министерството на външните работи за 2011 г. по политики и програми | pdf, otchet, programme, budget, execution |
| 13 | https://www.mfa.bg/upload/116956/1100-Otchet%20programi-m.12.2023.xlsx | Месечен касов отчет за м.01.2024 г. | xlsx, otchet, programme, 2024 |
| 13 | https://www.mfa.bg/upload/64232/%D0%9E%D1%82%D1%87%D0%B5%D1%82%20%D0%B7%D0%B0%20%D0%B8%D0%B7%D0%BF%D1%8A%D0%BB%D0%BD%D0%B5%D0%BD%D0%B8%D0%B5%D1%82%D0%BE%20%D0%BD%D0%B0%20%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BD%D0%B8%D1%8F%20%D0%BE%D1%82%D1%87%D0%B5%D1%82%20%D0%BA%D1%8A%D0%BC%2031.12.2020.zip | Доклад за изпълнението на програмния отчет към 31.12.2020.zip | zip, otchet, programme, execution, annual |
| 13 | https://www.mfa.bg/upload/135/Otchet_kasovo%20izpalnenie_MFA_budget_31%2012%202016.pdf | Тримесечен отчет за касовото изпълнение на бюджета на МВнР към 31.12.2016 г. | pdf, otchet, budget, execution, annual |
| 13 | https://www.mfa.bg/upload/212/31_12%20Mesechen%20kasov%20otchet%20za%20izpulnenie%20na%20budgeta%20na%20MFA%20kum%2031_12_2014.pdf | Месечен касов отчет за изпълнение на Бюджета на МВнР към 31.12.2014 г. | pdf, otchet, budget, execution, annual |
| 12 | https://www.mfa.bg/upload/151192/%D0%9F%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%B8%2030.09.2025.zip | Програмен отчет (към 30.09.2025г.) | zip, otchet, programme, 2025 |
| 12 | https://www.mfa.bg/upload/146793/%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%B5%D0%BD%20%D0%BE%D1%82%D1%87%D0%B5%D1%82%20%D0%BA%D1%8A%D0%BC%2030.06.2025.zip | Програмен отчет (към 30.06.2025 г.) | zip, otchet, programme, 2025 |
| 12 | https://www.mfa.bg/upload/146792/%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%B5%D0%BD%20%D0%BE%D1%82%D1%87%D0%B5%D1%821100_31032025.zip | Програмен отчет (към 31.03.2025 г.) | zip, otchet, programme, 2025 |
