#!/usr/bin/env python3
"""Plan T5.1 — the cited synthesis. The gate keeps only claims whose quotes
the cited articles actually contain; a „common" fact needs two outlets; a
dispute needs two attributed, quoted sides; nothing survives on a quote the
text does not carry; a single-outlet story is never synthesised; the cache
key moves with membership, content and rubric; a stale cache attaches
nothing. No network: `generate` is never called here."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import llm_client  # noqa: E402
import story_synthesis as ss  # noqa: E402

A = ("Прокуратурата обвини бившия министър Борислав Сандов за длъжностно престъпление във връзка със "
     "споразумението с организацията на Калушев. Сандов заяви, че не му е връчено обвинение и че не съжалява.")
B = ("Софийска градска прокуратура привлече Борислав Сандов като обвиняем за длъжностно престъпление. "
     "Адвокатът на Сандов каза, че призовка не е получавана и че клиентът му е спокоен.")
C = ("Министърът на правосъдието определи случая като едно от големите престъпления на десетилетието и "
     "каза, че производството за смъртта вероятно ще бъде прекратено.")


def member(i, domain, text):
    return {"url": f"https://{domain}/{i}", "domain": domain, "title": f"Заглавие {i}",
            "fields": [f"Заглавие {i}", "", text], "lede": text,
            "published": f"2026-09-2{i}T00:00:00+00:00", "content_sha256": f"h{i}"}


MEMBERS = [member(0, "a.bg", A), member(1, "b.bg", B), member(2, "c.bg", C)]


class TheGate(unittest.TestCase):
    def test_keeps_only_what_the_cited_articles_contain(self):
        answer = {
            "common": [
                {"claim": "Прокуратурата е повдигнала обвинение на Сандов за длъжностно престъпление.",
                 "supports": [{"article": 1, "quote": "обвини бившия министър Борислав Сандов за длъжностно престъпление"},
                              {"article": 2, "quote": "привлече Борислав Сандов като обвиняем за длъжностно престъпление"}]},
                # ⚠️ A fabricated quote against a real article: dropped.
                {"claim": "Сандов е подал оставка.",
                 "supports": [{"article": 1, "quote": "Сандов подаде оставка от всички постове"},
                              {"article": 2, "quote": "привлече Борислав Сандов като обвиняем за длъжностно престъпление"}]},
            ],
            "disputed": [
                {"claim": "Дали на Сандов е връчено обвинение.",
                 "positions": [{"article": 1, "attributed_to": "Сандов", "quote": "не му е връчено обвинение и че не съжалява"},
                               {"article": 2, "attributed_to": "адвокатът на Сандов", "quote": "призовка не е получавана и че клиентът му е спокоен"}]},
                # One side only after the gate: dropped.
                {"claim": "Дали делото ще влезе в съда.",
                 "positions": [{"article": 3, "attributed_to": "министърът", "quote": "производството за смъртта вероятно ще бъде прекратено"},
                               {"article": 1, "attributed_to": "Сандов", "quote": "делото със сигурност ще влезе в съда"}]},
            ],
            "emphasis": [
                {"article": 3, "note": "Определя случая по мащаб.", "quote": "едно от големите престъпления на десетилетието"},
                {"article": 3, "note": "Дубликат за същия материал.", "quote": "производството за смъртта вероятно ще бъде прекратено"},
                {"article": 9, "note": "Извън обхвата.", "quote": "нещо"},
            ],
        }
        synthesis, dropped = ss.gate(answer, MEMBERS)
        self.assertEqual(len(synthesis["common"]), 1)
        self.assertEqual({s["domain"] for s in synthesis["common"][0]["supports"]}, {"a.bg", "b.bg"})
        self.assertEqual(len(synthesis["disputed"]), 1)
        self.assertEqual([p["attributed_to"] for p in synthesis["disputed"][0]["positions"]],
                         ["Сандов", "адвокатът на Сандов"])
        self.assertEqual(len(synthesis["emphasis"]), 1)   # one per article, the out-of-range one dropped
        reasons = [d["reason"] for d in dropped]
        self.assertIn("quote not found in the cited article", reasons)
        self.assertIn("article index out of range", reasons)
        self.assertTrue(any("two outlets" in r for r in reasons))
        self.assertTrue(any("two attributed" in r for r in reasons))

    def test_a_dispute_needs_two_outlets_and_a_named_side_on_each(self):
        # ⚠️ TWO MUTATIONS THIS CATCHES: two positions from ONE outlet counted
        # as a dispute; a side with an empty `attributed_to` kept.
        same_outlet = {"common": [], "emphasis": [], "disputed": [{"claim": "x", "positions": [
            {"article": 1, "attributed_to": "Сандов", "quote": "не му е връчено обвинение и че не съжалява"},
            {"article": 1, "attributed_to": "прокуратурата", "quote": "обвини бившия министър Борислав Сандов за длъжностно престъпление"}]}]}
        synthesis, dropped = ss.gate(same_outlet, MEMBERS)
        self.assertEqual(synthesis["disputed"], [])
        self.assertEqual(len(dropped), 1)
        unattributed = {"common": [], "emphasis": [], "disputed": [{"claim": "x", "positions": [
            {"article": 1, "attributed_to": "", "quote": "не му е връчено обвинение и че не съжалява"},
            {"article": 2, "attributed_to": "адвокатът на Сандов", "quote": "призовка не е получавана и че клиентът му е спокоен"}]}]}
        synthesis, dropped = ss.gate(unattributed, MEMBERS)
        self.assertEqual(synthesis["disputed"], [])
        self.assertEqual(len(dropped), 1)

    def test_a_common_claim_needs_two_different_outlets(self):
        # ⚠️ THE MUTATION THIS CATCHES: counting two quotes from ONE outlet as agreement.
        answer = {"common": [{"claim": "x", "supports": [
            {"article": 1, "quote": "обвини бившия министър Борислав Сандов за длъжностно престъпление"},
            {"article": 1, "quote": "не му е връчено обвинение и че не съжалява"}]}], "disputed": [], "emphasis": []}
        synthesis, dropped = ss.gate(answer, MEMBERS)
        self.assertEqual(synthesis["common"], [])
        self.assertTrue(dropped)

    def test_a_quote_is_a_contiguous_span_not_a_token_bag(self):
        # ⚠️ Reordered or negation-dropped words must not pass.
        self.assertTrue(ss.quote_found("не му е връчено обвинение и че не съжалява", A))
        self.assertFalse(ss.quote_found("му е връчено обвинение и че съжалява напълно", A))
        self.assertFalse(ss.quote_found("обвинение връчено му е и че не съжалява", A))
        # Case and whitespace are folded; a short fragment is not evidence.
        self.assertTrue(ss.quote_found("  ОБВИНИ  бившия министър Борислав Сандов ", A))
        self.assertFalse(ss.quote_found("Сандов заяви", A))

    def test_quote_marks_are_folded_but_words_are_not(self):
        # ⚠️ THE MUTATION THIS CATCHES: treating „…“ vs "…" as different words.
        # Measured on the first cache: 13 of 40 „not found" drops were this.
        text = "Той каза: „Лукойл” има гарантиран нефт до ноември."
        self.assertTrue(ss.quote_found('"Лукойл" има гарантиран нефт до ноември', text))
        self.assertTrue(ss.quote_found("„Лукойл“ има гарантиран нефт до ноември.", text))
        self.assertFalse(ss.quote_found("„Лукойл“ няма гарантиран нефт до ноември.", text))
        # A trailing terminator or ellipsis is the model's, not the article's.
        self.assertTrue(ss.quote_found("Лукойл има гарантиран нефт до ноември.", "„Лукойл има гарантиран нефт до ноември“, каза той"))
        self.assertTrue(ss.quote_found("Лукойл има гарантиран нефт до…", "Лукойл има гарантиран нефт до ноември"))
        self.assertFalse(ss.quote_found("Лукойл има гарантиран нефт до май…", "Лукойл има гарантиран нефт до ноември"))
        # A prompt label in front of a real headline is not part of the quote.
        self.assertTrue(ss.quote_found("Заглавие: Лукойл има гарантиран нефт до ноември",
                                       ["Лукойл има гарантиран нефт до ноември", "", ""]))

    def test_a_span_across_title_and_body_is_not_a_quote(self):
        # ⚠️ THE MUTATION THIS CATCHES: collapsing the field seam into a space,
        # so title-end + body-start becomes a contiguous span the article
        # never printed.
        fields = ["Радев обяви оставка", "", "на кабинета днес в парламента"]
        self.assertFalse(ss.quote_found("обяви оставка на кабинета днес", fields))
        self.assertTrue(ss.quote_found("на кабинета днес в парламента", fields))

    def test_clean_quote_strips_one_balanced_outer_pair_only(self):
        self.assertEqual(ss.clean_quote("„Не съжалявам за нищо, каза той“"), "Не съжалявам за нищо, каза той")
        self.assertEqual(ss.clean_quote('  "Не  съжалявам"  '), "Не съжалявам")
        # Opening mark closed mid-way stays balanced.
        self.assertEqual(ss.clean_quote("„Лукойл“ има гарантиран нефт"), "„Лукойл“ има гарантиран нефт")
        self.assertEqual(ss.clean_quote("Заглавие: Крум Зарков: част от темите"), "Крум Зарков: част от темите")

    def test_an_empty_answer_is_empty_not_invented(self):
        synthesis, dropped = ss.gate({"common": [], "disputed": [], "emphasis": []}, MEMBERS)
        self.assertEqual(synthesis, {"common": [], "disputed": [], "emphasis": []})
        self.assertEqual(dropped, [])


class Eligibility(unittest.TestCase):
    def test_one_outlet_is_the_single_source_case(self):
        ok, reason = ss.eligible([member(0, "a.bg", A), member(1, "a.bg", B)])
        self.assertFalse(ok)
        self.assertEqual(reason, "single_source:1")
        self.assertTrue(ss.eligible(MEMBERS)[0])

    def test_pick_members_prefers_one_per_outlet(self):
        many = [member(i, f"o{i % 3}.bg", A) for i in range(12)]
        picked = ss.pick_members(many)
        self.assertEqual(len(picked), ss.MAX_MEMBERS)
        self.assertEqual({m["domain"] for m in picked[:3]}, {"o0.bg", "o1.bg", "o2.bg"})

    def test_the_cache_key_moves_with_membership_content_and_rubric(self):
        k = ss.synthesis_key(MEMBERS)
        self.assertEqual(k, ss.synthesis_key(list(reversed(MEMBERS))))   # order-free
        self.assertNotEqual(k, ss.synthesis_key(MEMBERS[:2]))
        changed = [dict(m) for m in MEMBERS]
        changed[0]["content_sha256"] = "moved"
        self.assertNotEqual(k, ss.synthesis_key(changed))
        with mock.patch.object(ss, "RUBRIC_VERSION", "story-synthesis-v2"):
            self.assertNotEqual(k, ss.synthesis_key(MEMBERS))


class TheStoryPath(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="synth_")
        self.root = Path(self.tmp.name)
        self.data_dir = self.root / "news" / "data"
        self.synth_dir = ss.synthesis_dir(self.data_dir)
        self.synth_dir.mkdir(parents=True)
        self.members = []
        for i, (domain, text) in enumerate((("a.bg", A), ("b.bg", B))):
            d = self.data_dir / domain
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{i}.json").write_text(json.dumps({"url": f"https://{domain}/{i}", "domain": domain,
                                                    "title": f"Заглавие {i}", "content": text}, ensure_ascii=False),
                                         encoding="utf-8")
            self.members.append({"url": f"https://{domain}/{i}", "domain": domain,
                                 "article_path": f"news/data/{domain}/{i}.json", "published": "2026-09-20T00:00:00+00:00"})
        self.story = {"id": "20260920-aaaa1111", "members": self.members}

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_failed_generation_keeps_the_headlines_and_never_invents(self):
        with mock.patch.object(ss, "generate", side_effect=RuntimeError("timeout")):
            out = ss.synthesize_story(self.story, self.data_dir, "m")
        self.assertEqual(out["status"], "failed")
        self.assertIsNone(out["synthesis"])
        self.assertIn("timeout", out["reason"])

    def test_a_dry_run_calls_nothing(self):
        with mock.patch.object(ss, "generate", side_effect=AssertionError("must not be called")):
            out = ss.synthesize_story(self.story, self.data_dir, "m", dry_run=True)
        self.assertEqual(out["status"], "would_generate")

    def test_current_for_attaches_only_a_matching_cache(self):
        members = ss.member_inputs(self.story, self.data_dir)
        doc = {"version": 1, "rubric_version": ss.RUBRIC_VERSION, "story_id": self.story["id"],
               "synthesis_key": ss.synthesis_key(members), "status": "ok",
               "synthesis": {"common": [], "disputed": [], "emphasis": []}}
        path = self.synth_dir / f"{self.story['id']}.json"
        path.write_text(json.dumps(doc), encoding="utf-8")
        self.assertIsNotNone(ss.current_for(self.story, self.data_dir))
        # ⚠️ THE MUTATION THIS CATCHES: attaching a cache whose key no longer
        # matches — a member's text changed, the synthesis quotes the old one.
        (self.data_dir / "a.bg" / "0.json").write_text(
            json.dumps({"url": "https://a.bg/0", "domain": "a.bg", "title": "t", "content": "друг текст"}), encoding="utf-8")
        self.assertIsNone(ss.current_for(self.story, self.data_dir))
        doc["rubric_version"] = "old"
        path.write_text(json.dumps(doc), encoding="utf-8")
        self.assertIsNone(ss.current_for(self.story, self.data_dir))
        # A failed document (retried next run, carrying an exception string)
        # ships nothing even when its key matches.
        (self.data_dir / "a.bg" / "0.json").write_text(
            json.dumps({"url": "https://a.bg/0", "domain": "a.bg", "title": "Заглавие 0", "content": A}), encoding="utf-8")
        doc.update(rubric_version=ss.RUBRIC_VERSION, status="failed", synthesis=None, reason="RuntimeError: x")
        path.write_text(json.dumps(doc), encoding="utf-8")
        self.assertIsNone(ss.current_for(self.story, self.data_dir))

    def test_current_for_id_reads_the_analysis_story_not_the_app_row(self):
        # ⚠️ THE MUTATION THIS CATCHES: keying the cache off the app-data story
        # row, whose members carry no `article_path` — the key is then over an
        # empty member set and never matches. The build attaches by id.
        stories = self.data_dir / "analysis" / "stories"
        stories.mkdir(parents=True)
        (stories / f"{self.story['id']}.json").write_text(json.dumps(self.story), encoding="utf-8")
        members = ss.member_inputs(self.story, self.data_dir)
        doc = {"version": 1, "rubric_version": ss.RUBRIC_VERSION, "story_id": self.story["id"],
               "synthesis_key": ss.synthesis_key(members), "status": "ok",
               "synthesis": {"common": [], "disputed": [], "emphasis": []}}
        (self.synth_dir / f"{self.story['id']}.json").write_text(json.dumps(doc), encoding="utf-8")
        self.assertIsNotNone(ss.current_for_id(self.story["id"], self.data_dir))
        self.assertIsNone(ss.current_for_id("20260101-missing0", self.data_dir))
        app_row = {"id": self.story["id"], "members": [{"domain": m["domain"], "url": m["url"]} for m in self.members]}
        self.assertIsNone(ss.current_for(app_row, self.data_dir))

    def test_main_end_to_end_with_a_mocked_generator(self):
        # A second, single-outlet story beside the two-outlet one.
        stories = self.data_dir / "analysis" / "stories"
        stories.mkdir(parents=True, exist_ok=True)
        (stories / f"{self.story['id']}.json").write_text(json.dumps(self.story), encoding="utf-8")
        single = {"id": "20260919-bbbb2222", "members": [self.members[0]]}
        (stories / f"{single['id']}.json").write_text(json.dumps(single), encoding="utf-8")
        (self.data_dir / "analysis" / "index.json").write_text(json.dumps({"stories": {
            self.story["id"]: {"member_count": 2, "last_published": "2026-09-20"},
            single["id"]: {"member_count": 2, "last_published": "2026-09-19"}}}), encoding="utf-8")
        raw = {"common": [{"claim": "Сандов е обвинен.", "supports": [
                   {"article": 1, "quote": "обвини бившия министър Борислав Сандов за длъжностно престъпление"},
                   {"article": 2, "quote": "привлече Борислав Сандов като обвиняем за длъжностно престъпление"}]}],
               "disputed": [], "emphasis": []}
        argv = ["--data-dir", str(self.data_dir), "--limit", "5", "--model", "m"]
        with mock.patch.object(ss, "generate", return_value={"raw": raw, "usage": None, "model": "m"}) as gen, \
                mock.patch.object(llm_client, "load_env_files", lambda **_: None):
            self.assertEqual(ss.main(argv + ["--dry-run"]), 0)
            self.assertEqual(sorted(self.synth_dir.iterdir()), [])        # a dry run writes nothing
            gen.assert_not_called()
            self.assertEqual(ss.main(argv), 0)
            self.assertEqual(gen.call_count, 1)                           # the single-source story is skipped
            written = sorted(p.name for p in self.synth_dir.iterdir())
            self.assertEqual(written, [f"{self.story['id']}.json"])
            self.assertEqual(json.loads((self.synth_dir / written[0]).read_text())["status"], "ok")
            self.assertEqual(ss.main(argv), 0)
            self.assertEqual(gen.call_count, 1)                           # cache hit: generate not called again
            self.assertEqual(ss.main(argv + ["--force"]), 0)
            self.assertEqual(gen.call_count, 2)

    def test_the_whole_answer_goes_through_the_gate(self):
        raw = {"common": [{"claim": "измислено", "supports": [
                   {"article": 1, "quote": "този цитат не съществува в никой от материалите"},
                   {"article": 2, "quote": "нито пък този, макар да е достатъчно дълъг"}]}],
               "disputed": [], "emphasis": []}
        with mock.patch.object(ss, "generate", return_value={"raw": raw, "usage": None, "model": "m"}):
            out = ss.synthesize_story(self.story, self.data_dir, "m")
        self.assertEqual(out["status"], "empty")
        self.assertIsNone(out["synthesis"])
        self.assertEqual(len(out["dropped"]), 3)


if __name__ == "__main__":
    unittest.main()
