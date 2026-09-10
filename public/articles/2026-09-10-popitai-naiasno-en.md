---
author: Codex
updatedAt: 2026-09-10
schemaType: Article
---

# Ask Наясно: a new way to explore Bulgaria’s public data

What do basic groceries cost in Plovdiv? What did the state plan to spend, and what has it reported so far? How do you move from a procurement total to a particular procedure? **Ask Наясно** lets you start with a question and brings together ready-made queries, tables and charts from the site’s data.

[Ask your first question](/chat). You can start without AI or an AI access check. Choose a starter question or type your own. When you want more flexible wording and an explanation, select the AI assistant from the mode menu.

The chat is now part of the main site, alongside its tools and detailed dashboards. Наясно is the project’s new name; the move to naiasno.bg is still ahead. The chat’s path remains `/chat`.

## What can you ask about?

Starter questions are grouped around practical interests: prices and household spending; budgets, taxes and procurement; elections, parliament and local government; population and living conditions; health, education, pensions and social support. There are also queries about EU funding, agriculture, companies and declared interests, energy, the environment and other areas.

This does not mean that every question about these subjects has an answer. Each query has a particular dataset, period and geographical scope. Information being available somewhere on the site also does not mean that the chat can already retrieve it from any wording.

Explore the [tools catalogue](/chat/tools) and [data sources page](/data/sources). They provide the starting point for checking where information comes from—for example, the Central Election Commission, Ministry of Finance, National Statistical Institute and Public Procurement Agency. The chat helps you find a query; its source and methodology explain what it measures.

## Starters, your own questions and follow-ups

The easiest starting point is **Topics → Subtopic → Question**. Choose what interests you, and the starter supplies the parameters for the appropriate query. You can also type in the composer. Naming the place, year, institution or procedure number helps.

![The starting screen with guided questions, the composer and mode selection.](/articles/images/chat-launch/start-en.png)

Suggested questions below an answer help you continue to another query. You can type a follow-up too, but a short “and there?” or “and before that?” is not always understood correctly. If the answer changes the place or period, repeat them explicitly. When in doubt, choose a starter or open the corresponding dashboard.

## Three questions to begin with

**Prices in your town.** [“What are the prices in Plovdiv?”](/chat?q=What+are+the+prices+in+Plovdiv%3F) shows selected products, their lowest and average prices, and a chain with the lowest reported price. In our check, the observations were dated **8 September 2026**. That is the observation date, not this article’s date.

Read the product description too: “bread, 500g to 1kg” does not represent an identical package in every record. A quoted price does not guarantee availability in every shop today. The basket is consumer-protection monitoring, not the official Consumer Price Index. Use it for orientation, then check the particular product and retailer.

**Budget plan and execution.** [“What is the state budget — plan and actual spending?”](/chat?q=What+is+the+state+budget+%E2%80%94+plan+and+actual+spending%3F) returns two different columns. The example shows **€34.5bn** in planned annual expenditure and **€16.5bn** recorded through **31 July 2026**. Seven months of execution are not a full-year account; that difference alone does not demonstrate savings or failure to deliver.

![The budget query shows its reporting period, annual plan, actual execution and dashboard link.](/articles/images/chat-launch/budget-en.png)

This query covers the state budget, not the whole general-government sector. Its balance also subtracts the contribution to the EU budget. Open the [budget dashboard](/budget) for the scope and details.

**Seats in parliament.** [“How many seats does each party hold in parliament?”](/chat?q=How+many+seats+does+each+party+hold+in+parliament%3F) shows the allocation of 240 seats from the **19 April 2026 election**. The date matters: this is the election allocation, not a promise of a live faction-membership list after every departure or change.

## No AI and the AI assistant

In **No AI** mode, starters and recognized wording invoke predefined tools. These retrieve data, perform calculations and arrange the results. The short explanation follows a template. No language model is used for that response, but fetching data still needs an internet connection.

In **AI mode**, the model helps interpret the question and explain the tools’ results. Your question and conversation context are processed in the cloud through Google Gemini. Tables and charts come from the tools; the free-form narrative around them needs a separate check. AI can miss a qualification, choose an unsuitable query or make an unsupported inference.

For example, add this to the budget question: “State the reporting period and explain the difference between plan and execution.” In our Bulgarian test, AI identified the correct period and figures. That is one useful explanation, not a guarantee that every later response will be correct. Compare the numbers with the table and open the source when in doubt.

## Two deeper checks

**From a topic to a procedure.** [“Show me all road-guardrail tenders in 2025”](/chat?q=Show+me+all+road-guardrail+tenders+in+2025) searches the available corpus for that topic and year. “All” in the starter does not guarantee completeness outside the corpus’s coverage. Our checked response contained two procedures.

Select the suggested **“Show tender 00044-2025-0125”**. Its details include the buyer, date, six lots and an estimated value of approximately €490.8m. This is an **announced estimate, not a payment**. The status is also the one held in the available data, not an independent confirmation of today’s position.

![A suggested follow-up opens a specific procedure with an estimate, date and detailed-record link.](/articles/images/chat-launch/followup-en.png)

Open [the procedure](/tenders/00044-2025-0125), read its records and follow the original source. A query finding no contract does not prove that none exists in another source.

**A polling section over time.** [“How has section 050900092 voted over the years?”](/chat?q=How+has+section+050900092+voted+over+the+years%3F) shows a series across 12 elections for the section labelled Inovo in the data. Use the [section dashboard](/section/050900092) to check individual elections. An unchanged code does not prove unchanged voters or boundaries. Parties and coalitions change too; a gap in a series is not automatically a zero result.

## Missing data, verification and limits

Try [“What is the state budget in 2027?”](/chat?q=What+is+the+state+budget+in+2027%3F). In our check, the chat stated that 2027 data were unavailable and displayed 2026 instead. **The warning appears below the query title**; the opening sentence describes the displayed 2026 figures. This is a fallback query, not a forecast for 2027. Read the title, period and coverage, not only the first sentence.

AI access uses **Cloudflare Turnstile** to check for automated abuse. Verification may repeat when the session expires. Current limits allow up to **20 question starts per verified session per day**, **60 per IP address per day**, and **3 during the last 60 seconds per session**. A session lasts one hour. Daily accounting renews at **00:00 UTC**, not local midnight.

![The mode menu with its explanation of limits, cloud processing and conversation history.](/articles/images/chat-launch/limits-en.png)

This is not a personal daily allowance: people sharing a network share the IP limit. Reverification does not clear that limit or the service’s shared budget. Failed or interrupted requests can consume allowance, and the shared budget may temporarily stop AI earlier. You can continue with **No AI**, although data or network failures can prevent that mode from returning a query too.

Conversation and prompt history stay in the browser for the current domain. If you used the separate old chat, export conversations you need from there: they do not transfer automatically. A shared link contains the last question and asks it again; it does not preserve the whole conversation or a historical answer. Do not share a context-dependent question such as “and in 2023?” on its own.

## How it compares with other tools

Different tools suit different tasks. This comparison was checked on **10 September 2026** and is not an accuracy ranking.

| Tool | Useful approach and checked status |
| --- | --- |
| **Ask Наясно** | Dedicated queries over the loaded Bulgarian datasets, with tables, charts and dashboard links. The examples here have specific coverage; free-text questions have limitations. |
| **[ChatGPT](https://help.openai.com/en/articles/9237897)** | Broader web search and explanation with source controls. In our small test it retained follow-up context and displayed a table and chart. This does not certify every answer’s accuracy. |
| **[Perplexity](https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work)** | Documents web search, cited answers and contextual follow-ups. Our anonymous session requested sign-up before answering; conversational tasks were not assessed. |
| **[Data Commons](https://www.datacommons.org/faq)** | Maps natural language to sourced structured statistics. We received dated charts; the short “and in 2023?” in its search field did not resolve a place. It also offers suggested related questions. |
| **[СИГМА](https://sigma.midt.bg)** | A specialist public procurement portal with a [documented AI assistant design](https://github.com/midt-bg/sigma/blob/main/docs/spec/ai-assistant.md) covering Bulgarian text and voice. We found no chat on the inspected homepage and do not treat planned features as tested live capabilities. |

Specialist search tools such as [OpenTender Bulgaria](https://opentender.eu/bg) and [BIRD’s declaration search](https://bird.bg/judicial-money/) can help with particular checks too. Compare periods, units and original sources before comparing totals between sites.

[Open Ask Наясно](/chat) and begin with one concrete question. If an answer is unclear or wrong, use the community link beneath it and identify the question, mode and mismatch with the source—without personal or confidential information.
