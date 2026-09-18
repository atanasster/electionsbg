# „Is Jev worth the hype?" — post drafts

Link for every post: https://naiasno.bg/chat/evals

Every figure below is on that page (summary, robustness section, timeline) or in
`data/ai/evals/index.json`. The posts say the chat uses Jev: true once the
on-by-default deploy of 2026-09-18 is live. Before posting, re-scrape
https://naiasno.bg/chat/evals in Facebook's Sharing Debugger and LinkedIn's Post
Inspector so they pick up the new OG card.

Numbers, for checking (English / Bulgarian, right tool):

| questions | rules | Jev alone | Gemini alone | Jev + Gemini | Jev + rules |
| --- | --- | --- | --- | --- | --- |
| as written | 84.6 / 90.0 | 95.0 / 92.5 | 87.5 / 87.8 | 96.1 / 95.7 | 93.5 / 94.3 |
| with typos | 28.3 / 33.7 | 93.9 / 85.7 | 88.2 / 87.1 | 96.1 / 94.3 | 75.3 / 66.7 |
| reworded | 14.7 / 24.7 | 86.4 / 86.4 | 77.8 / 79.9 | 86.0 / 89.6 | 64.9 / 64.5 |
| Latin letters (BG) | 6.5 | 71.3 | 93.5 | 95.0 | 45.2 |

Same-day, same 474 questions: Jev + Gemini vs Gemini alone — right parameters
94.3 / 90.6 vs 83.0 / 77.4; prompt 3,697 vs 16,150 tokens on average; median
latency 893 vs 692 ms.

---

## 1. Facebook (Наясно page) — BG, no hashtags

Струва ли си шумът около Jev?

Jev е модел на TypeSafe, който не пише текст. Той само избира между готови варианти и казва колко е сигурен. Изпробвахме го в AI чата на Наясно — там, където въпросът ви трябва да стигне до правилната таблица с данни.

Какво открихме:

- Когато въпросът е написан с грешки, Jev избира правилния инструмент в 94% от случаите на английски и 86% на български. Нашите правила по ключови думи — в около една трета.
- Jev сам не стига: не може да попълни име, ЕИК или свободен текст. Затова го сложихме пред Gemini — Jev избира инструмента, Gemini попълва само неговите параметри.
- Така параметрите са верни в 94% / 91% срещу 83% / 77% при само Gemini, а подканата е четири пъти по-кратка. Цената: около 0,2 секунди повече.
- Слабо място: български, написан на латиница. Там Gemini е по-добър.

И едно признание: първият ни тест показа, че Jev е почти колкото правилата. Оказа се, че 91% от въпросите в теста бяха примерите, от които правилата са писани. Тестът облагодетелстваше правилата — затова направихме нов.

Всички резултати и как стигнахме до решението:
https://naiasno.bg/chat/evals

---

## 2. LinkedIn — EN, 2 hashtags, hook before the fold

Is Jev worth the hype? We tested it on a real civic-data chat. Mostly yes — but not alone.

Jev (TypeSafe's "System One") generates no text: it picks among options you give it and returns a calibrated confidence. We put it in front of the tool routing of Наясно, a Bulgarian public-data chat with 235 typed tools.

What we measured:

- Robustness is where it shines. With typos, Jev alone picks the right tool 94% (EN) / 86% (BG) of the time. Our keyword rules: 28% / 34%. Reworded questions: 86% vs 15–25%.
- It cannot fill open values — names, company IDs, free text. It has no primitive that produces one.
- So it now routes for Gemini 3.5 Flash-Lite: Jev picks the tool, Gemini fills only that tool's parameters. Same day, same 474 questions: parameters right 94.3% / 90.6% vs 83.0% / 77.4% for Gemini alone, with a 4x shorter prompt (3,697 vs 16,150 tokens) and ~0.2 s added median latency.
- Weak spot: Bulgarian typed in Latin letters — 71% for Jev vs 94% for Gemini. When Jev is unsure, the question goes to Gemini with the full catalogue.

The lesson we did not expect: our first evaluation said Jev was barely better than our rules. 91% of that test bank were the examples the rules were built from. A test made of your baseline's training data flatters the baseline. We rebuilt it with typos, paraphrases and transliteration.

Full results, method and decision history: https://naiasno.bg/chat/evals

#AI #LLM

---

## 3. Viber — AI professionals in Bulgaria, BG, technical

Струва ли си шумът около Jev? Нашите числа от реален чат с 235 инструмента

Интегрирахме Jev (TypeSafe, „System One") в маршрутизацията на AI чата на Наясно (обществени данни: избори, бюджет, поръчки). Накратко какво намерихме, с детайлите, които обикновено липсват:

Какво е: не генерира текст. Задаваш типизирани въпроси — Choice (избор между варианти), Noul (вероятност да/не), Score — и получаваш ограничен отговор с увереност. Питаме три неща в един batched call: кой инструмент, дали въпросът е съставен, дали е за данни или разговор. Паралелно са, така че три въпроса струват колкото един.

Калибрацията е реална (n=458): над 0,9 увереност — 100% верни; 0,7–0,9 — 94%; 0,5–0,7 — 83%; под 0,5 — 59%. Прагът ни е 0,7.

Архитектурата в AI режима:
- уверен избор на инструмент без параметри → изпълняваме директно (27% от въпросите);
- уверен избор с параметри → Gemini 3.5 Flash-Lite вижда само този инструмент и попълва аргументите (57%);
- иначе → Gemini с целия каталог, както преди (16%).
Резервният път е винаги пълният Gemini prompt, никога ключовите правила — потребител, избрал AI, не бива да получи по-слаб отговор заради Jev. Бюджетът на прокси-то е 3 upstream извиквания на въпрос общо за Jev и Gemini.

Резултати, същия ден, едни и същи 474 въпроса (EN / BG):
- верни параметри: 94,3% / 90,6% срещу 83,0% / 77,4% за само Gemini;
- подкана: средно 3 697 срещу 16 150 токена;
- медианно време: 893 срещу 692 ms.
Хипотезата ни е, че моделът попълва по-точно, когато вижда един инструмент вместо 235.

Устойчивост — 1 953 варианта (изкуствени грешки в две думи, парафрази от модел, транслитерация):
- с грешки: Jev сам 94% / 86%, само Gemini 88% / 87%, ключови правила 28% / 34%;
- с други думи: Jev 86% / 86%, Gemini 78% / 80%, правила 15% / 25%;
- шльокавица: Jev 71%, Gemini 94%, правила 7%. Тук Jev губи.

Режим без генеративен модел: Jev избира, а параметрите се четат с правила по тип (година, брой, № на НС, партия, община по газетир с fuzzy match само след „в/община/in", област). Когато нещо липсва — питаме, вместо да гадаем. С грешки: 75% / 67% верни срещу 28% / 34% за правилата, а грешните отговори падат от 30% / 25% на 6% / 12%. В чата засега не е включен — Jev минава през нашия сървър, а режимът без AI по замисъл не зависи от него.

Два урока:
1. Test leakage. Първата оценка показа Jev ≈ правилата. 91% от въпросите бяха примерите, от които правилата са писани. Ако тестът е обучаващото множество на baseline-а, baseline-ът печели.
2. Jev не може да генерира стойност (име, ЕИК, свободен текст) — няма такъв примитив. Имената решаваме с trigram търсене + Jev избира сред реални кандидати или отказва.

Цена: $42 на милиард входни токена, изходът е безплатен — около $0,0005 на извикване с целия каталог. Фиксираме версионирано id на модела, не `jev-latest`, защото праговете на увереност се калибрират за версия.

Всички таблици, методиката и историята на решенията:
https://naiasno.bg/chat/evals
