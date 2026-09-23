#!/usr/bin/env python3
"""Contract tests for the unattended nightly news pipeline runner."""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "news" / "scripts" / "run_nightly.sh"


# Pipeline CHILD processes (which never import unittest) emit perf-log
# events, so the in-process default does not reach them: redirect through the
# environment they inherit, and restore it afterwards.
_PERF_PRIOR = None


def setUpModule():
    global _PERF_TMP, _PERF_PRIOR
    _PERF_PRIOR = os.environ.get("NEWS_PERF_DIR")
    _PERF_TMP = tempfile.mkdtemp(prefix="news_perf_")
    os.environ["NEWS_PERF_DIR"] = _PERF_TMP


def tearDownModule():
    import shutil
    if _PERF_PRIOR is None:
        os.environ.pop("NEWS_PERF_DIR", None)
    else:
        os.environ["NEWS_PERF_DIR"] = _PERF_PRIOR
    shutil.rmtree(_PERF_TMP, ignore_errors=True)


class NightlyRunnerContractTests(unittest.TestCase):
    def run_runner(self, *args: str) -> subprocess.CompletedProcess[str]:
        return self.run_runner_at(RUNNER, *args)

    def run_runner_at(self, runner: Path, *args: str,
                      env: dict | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(runner), *args], cwd=runner.parents[2], text=True,
            capture_output=True, check=False, env=env)

    def copy_runner(self, root: Path) -> Path:
        runner = root / "news" / "scripts" / "run_nightly.sh"
        runner.parent.mkdir(parents=True)
        runner.write_text(RUNNER.read_text(encoding="utf-8"), encoding="utf-8")
        source_timeout = RUNNER.parent / "bin" / "timeout"
        target_timeout = runner.parent / "bin" / "timeout"
        target_timeout.parent.mkdir(parents=True)
        target_timeout.write_text(source_timeout.read_text(encoding="utf-8"),
                                  encoding="utf-8")
        target_timeout.chmod(0o755)
        return runner

    def stub_runtime_scripts(self, runner: Path) -> None:
        for name in ("llm_client.py", "build_prompts.py", "build_gazetteer.py",
                     "analyze_local.py", "build_image_rights_queue.py",
                     "source_commons_images.py", "review_routing.py",
                     "build_mention_index.py", "eval_runtime.py",
                     "build_app_data.py", "home_health.py", "jev_ask.py"):
            (runner.parent / name).write_text(
                "import json; print(json.dumps({}))\n", encoding="utf-8")

    def write_acquisition_script(self, path: Path, verdict: str | None,
                                 exit_code: int = 0) -> None:
        lines = ["#!/bin/bash", "artifact=$2"]
        if verdict is not None:
            lines.append(f"printf '%s\\n' {json.dumps(verdict)} > \"$artifact\"")
        lines.append(f"exit {exit_code}")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        path.chmod(0o755)

    def test_rejects_missing_or_invalid_option_values_before_running(self):
        for args, expected in (
            (("--limit",), "--limit requires N"),
            (("--limit", "ten"), "--limit must be a non-negative integer"),
            (("--model",), "--model requires NAME"),
            (("--model", ""), "--model requires NAME"),
            (("--workers",), "--workers requires N"),
            (("--workers", "0"), "--workers must be at least 1"),
            (("--workers", "four"), "--workers must be a non-negative integer"),
            (("--schema-retries",), "--schema-retries requires 0 or 1"),
            (("--schema-retries", "2"), "--schema-retries must be 0 or 1"),
            (("--stage-timeout",), "--stage-timeout requires SECONDS"),
            (("--stage-timeout", "slow"),
             "--stage-timeout must be a non-negative integer"),
            (("--articles-per-source",), "--articles-per-source requires N"),
            (("--browser-timeout", "slow"),
             "--browser-timeout must be a non-negative integer"),
            (("--run-id",), "--run-id requires ID"),
            (("--run-id", "bad/id"), "--run-id must contain only"),
        ):
            with self.subTest(args=args):
                proc = self.run_runner(*args)
                self.assertEqual(proc.returncode, 2)
                self.assertIn(expected, proc.stderr)

    def test_dry_run_isolated_artifacts_and_skips_every_stage(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            first = self.run_runner_at(
                runner, "--dry-run", "--articles-per-source", "3",
                "--browser-timeout", "15", "--workers", "4",
                "--schema-retries", "1", "--skip-browser",
                "--run-id", "wrapper-test")
            second = self.run_runner_at(runner, "--dry-run")
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            reports = sorted((root / "news" / "data" / "_nightly").glob("*.json"))
            self.assertEqual(len(reports), 2)
            for report in reports:
                data = __import__("json").loads(report.read_text(encoding="utf-8"))
                self.assertEqual(data["stages_run"], 15)
                self.assertEqual(data["stages_ok"], 15)
                self.assertTrue(all(s["result"] == {"skipped": "dry_run"}
                                    for s in data["stages"]))
                self.assertEqual(data["acquisition"]["direct"]["skipped"], "dry_run")
                self.assertEqual(data["acquisition"]["browser"]["skipped"], "dry_run")
            first_report = __import__("json").loads(
                (root / "news/data/_nightly/wrapper-test.json").read_text(
                    encoding="utf-8"))
            self.assertEqual(first_report["run_id"], "wrapper-test")

            reused = self.run_runner_at(
                runner, "--dry-run", "--run-id", "wrapper-test")
            self.assertEqual(reused.returncode, 2)
            self.assertIn("artifact already exists", reused.stderr)

    def test_live_owner_lock_skips_before_any_stage_starts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            lock = root / "news" / "data" / "_nightly" / "pipeline.lock"
            lock.mkdir(parents=True)
            (lock / "pid").write_text(str(os.getpid()) + "\n", encoding="utf-8")
            proc = self.run_runner_at(runner, "--dry-run")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(__import__("json").loads(proc.stdout)["skipped"],
                             "already_running")
            self.assertEqual(list(lock.parent.glob("*.json")), [])

    def test_runner_supplies_timeout_under_a_minimal_cron_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            env = os.environ.copy()
            env["PATH"] = f"{Path(sys.executable).parent}:/usr/bin:/bin"
            proc = self.run_runner_at(runner, "--dry-run", env=env)
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_rejects_invalid_model_parameters_from_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            runner = self.copy_runner(Path(temp))
            for name, value, expected in (
                ("NEWS_LLM_MAX_TOKENS", "0", "must be at least 1"),
                ("NEWS_LLM_MAX_TOKENS", "many", "non-negative integer"),
                ("NEWS_LLM_TEMPERATURE", "hot", "number between 0 and 2"),
                ("NEWS_LLM_TEMPERATURE", "2.1", "number between 0 and 2"),
            ):
                with self.subTest(name=name, value=value):
                    env = {**os.environ, name: value}
                    proc = self.run_runner_at(runner, "--dry-run", env=env)
                    self.assertEqual(proc.returncode, 2)
                    self.assertIn(expected, proc.stderr)

    def test_timeout_wrapper_kills_the_descendant_process_group(self):
        with tempfile.TemporaryDirectory() as temp:
            marker = Path(temp) / "descendant-survived"
            wrapper = RUNNER.parent / "bin" / "timeout"
            child = (
                "import pathlib,time,sys; time.sleep(.4); "
                "pathlib.Path(sys.argv[1]).write_text('bad')")
            parent = (
                "import subprocess,sys,time; "
                "subprocess.Popen([sys.executable,'-c',sys.argv[2],sys.argv[1]]); "
                "time.sleep(5)")
            proc = subprocess.run(
                [str(wrapper), "0.1", sys.executable, "-c", parent,
                 str(marker), child], capture_output=True, text=True,
                check=False)
            self.assertEqual(proc.returncode, 124, proc.stderr)
            time.sleep(.5)
            self.assertFalse(marker.exists(),
                             "a descendant survived the timeout process-group kill")

    def test_model_probe_failure_skips_analysis(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            source = runner.read_text(encoding="utf-8")
            source = source.replace(
                'stage probe_model python3 news/scripts/llm_client.py --model "$MODEL"',
                "stage probe_model python3 -c 'import json,sys; print(json.dumps({})); sys.exit(1)'")
            runner.write_text(source, encoding="utf-8")
            self.stub_runtime_scripts(runner)
            self.write_acquisition_script(
                runner.parent / "save_all_direct.sh",
                json.dumps({"mode": "intake-report", "domains": 1, "alerts": []}))
            proc = self.run_runner_at(runner, "--skip-browser")
            self.assertEqual(proc.returncode, 1, proc.stderr)
            report = next((root / "news" / "data" / "_nightly").glob("*.json"))
            data = __import__("json").loads(report.read_text(encoding="utf-8"))
            direct = next(s for s in data["stages"] if s["stage"] == "acquire_direct")
            browser = next(s for s in data["stages"] if s["stage"] == "acquire_browser")
            self.assertEqual((direct["exit"], browser["exit"]), (0, 0))
            self.assertTrue(all(s["exit"] == 0 for s in data["stages"]
                                if s["stage"] not in {"probe_model"}))
            analysis = next(s for s in data["stages"] if s["stage"] == "analyze")
            self.assertEqual(analysis["result"], {"skipped": "model_unavailable"})

    def test_acquisition_artifact_contract_and_exit_preservation(self):
        cases = (
            ("valid", json.dumps({"mode": "intake-report", "domains": 2,
                                  "alerts": []}), 0, 0),
            ("producer-failed", json.dumps({"mode": "intake-report", "domains": 2,
                                            "alerts": []}), 7, 7),
            ("absent", None, 0, 2),
            ("empty", "", 0, 2),
            ("invalid-json", "not json", 0, 2),
            ("wrong-schema", json.dumps({}), 0, 2),
        )
        for label, verdict, producer_exit, expected_exit in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory(
                    prefix="nightly acquisition # ") as temp:
                root = Path(temp)
                runner = self.copy_runner(root)
                self.stub_runtime_scripts(runner)
                self.write_acquisition_script(
                    runner.parent / "save_all_direct.sh", verdict, producer_exit)
                run_id = f"direct-{label}"
                proc = self.run_runner_at(
                    runner, "--skip-browser", "--run-id", run_id)
                self.assertEqual(proc.returncode, 0 if expected_exit == 0 else 1,
                                 proc.stderr)
                report = json.loads(
                    (root / f"news/data/_nightly/{run_id}.json").read_text(
                        encoding="utf-8"))
                acquired = next(stage for stage in report["stages"]
                                if stage["stage"] == "acquire_direct")
                self.assertEqual(acquired["exit"], expected_exit)
                if expected_exit == 0:
                    self.assertEqual(acquired["result"]["mode"], "intake-report")

    def test_browser_acquisition_uses_the_same_artifact_contract(self):
        with tempfile.TemporaryDirectory(prefix="nightly browser # ") as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            self.stub_runtime_scripts(runner)
            verdict = json.dumps(
                {"mode": "intake-report", "domains": 1, "alerts": []})
            self.write_acquisition_script(
                runner.parent / "save_all_direct.sh", verdict)
            self.write_acquisition_script(
                runner.parent / "save_all_browser.sh", verdict)
            proc = self.run_runner_at(runner, "--run-id", "browser-valid")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            report = json.loads(
                (root / "news/data/_nightly/browser-valid.json").read_text(
                    encoding="utf-8"))
            browser = next(stage for stage in report["stages"]
                           if stage["stage"] == "acquire_browser")
            self.assertEqual(browser["exit"], 0)
            self.assertEqual(browser["result"], json.loads(verdict))

    def test_zero_limit_skips_analysis_without_invoking_the_model_loop(self):
        with tempfile.TemporaryDirectory(prefix="nightly zero limit # ") as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            self.stub_runtime_scripts(runner)
            verdict = json.dumps(
                {"mode": "intake-report", "domains": 1, "alerts": []})
            self.write_acquisition_script(
                runner.parent / "save_all_direct.sh", verdict)
            marker = root / "analyze-local-was-called"
            (runner.parent / "analyze_local.py").write_text(
                "from pathlib import Path\n"
                f"Path({str(marker)!r}).write_text('bad')\n"
                "print('{}')\n",
                encoding="utf-8")
            # Optional eval mode may preserve a failed sub-operation in its
            # successful result. Only the stage envelope controls the runner
            # status; a nested `exit` must not be read as a failed stage.
            (runner.parent / "eval_runtime.py").write_text(
                "import json\n"
                "print(json.dumps({'raw_export': {'exit': 1}, "
                "'publication_blocked': False}))\n",
                encoding="utf-8")

            proc = self.run_runner_at(
                runner, "--skip-browser", "--limit", "0",
                "--run-id", "zero-limit")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertFalse(marker.exists())
            report = json.loads(
                (root / "news/data/_nightly/zero-limit.json").read_text(
                    encoding="utf-8"))
            analysis = next(stage for stage in report["stages"]
                            if stage["stage"] == "analyze")
            self.assertEqual(analysis["exit"], 0)
            self.assertEqual(
                analysis["result"], {"skipped": "configured_zero_limit"})

    def test_the_runner_and_the_uploader_agree_on_the_stage_order(self):
        """⚠️ Two copies of one list. The uploader refuses any report whose
        stage names differ from its own `EXPECTED_STAGES`, so a stage added to
        the runner alone refuses EVERY public release — measured when the
        `sentiment` stage was wired, the bundle's own dry-run came back
        `invalid_pipeline_report: incomplete or reordered stages`."""
        import re
        sys.path.insert(0, str(ROOT / "news" / "standalone"))
        import upload_to_gcs
        runner = RUNNER.read_text(encoding="utf-8")
        # The LIVE arm of each stage, i.e. first occurrence per name in order.
        seen: list[str] = []
        for name in re.findall(r"^\s*stage ([a-z0-9_]+) ", runner, re.M):
            if name not in seen:
                seen.append(name)
        self.assertEqual(seen, list(upload_to_gcs.EXPECTED_STAGES))
        declared = int(re.search(r"^STAGES_EXPECTED=(\d+)$", runner, re.M).group(1))
        self.assertEqual(declared, len(upload_to_gcs.EXPECTED_STAGES))

    def run_sentiment(self, root: Path, jev_ask_source: str, *args: str,
                      env_extra: dict | None = None) -> dict:
        runner = self.copy_runner(root)
        self.stub_runtime_scripts(runner)
        (runner.parent / "jev_ask.py").write_text(jev_ask_source, encoding="utf-8")
        self.write_acquisition_script(
            runner.parent / "save_all_direct.sh",
            json.dumps({"mode": "intake-report", "domains": 1, "alerts": []}))
        env = {**os.environ, **(env_extra or {})}
        proc = self.run_runner_at(runner, "--skip-browser", "--run-id", "s",
                                  *args, env=env)
        report = json.loads((root / "news/data/_nightly/s.json").read_text(
            encoding="utf-8"))
        return {"proc": proc, "report": report,
                "stage": next(s for s in report["stages"]
                              if s["stage"] == "sentiment")}

    def test_sentiment_runs_as_a_stage_and_passes_its_limit(self):
        with tempfile.TemporaryDirectory(prefix="nightly sentiment # ") as temp:
            out = self.run_sentiment(
                Path(temp),
                "import json, sys\n"
                "print(json.dumps({'argv': sys.argv[1:], 'assessed': 3}))\n",
                env_extra={"NEWS_JEV_SENTIMENT_LIMIT": "37"})
            self.assertEqual(out["proc"].returncode, 0, out["proc"].stderr)
            self.assertEqual(out["stage"]["exit"], 0)
            self.assertEqual(out["stage"]["result"]["argv"],
                             ["--stage", "--limit", "37"])
            self.assertEqual(out["report"]["sentiment"]["assessed"], 3)

    def test_a_zero_sentiment_limit_skips_without_calling_jev(self):
        with tempfile.TemporaryDirectory(prefix="nightly sentiment zero # ") as temp:
            marker = Path(temp) / "jev-was-called"
            out = self.run_sentiment(
                Path(temp),
                f"from pathlib import Path; Path({str(marker)!r}).write_text('x')\n"
                "print('{}')\n",
                env_extra={"NEWS_JEV_SENTIMENT_LIMIT": "0"})
            self.assertEqual(out["proc"].returncode, 0, out["proc"].stderr)
            self.assertFalse(marker.exists())
            self.assertEqual(out["stage"]["result"],
                             {"skipped": "configured_zero_limit"})

    def test_a_sentiment_payload_bug_is_lifted_to_the_report_not_hidden(self):
        # ⚠️ The stage exits 0 on our bug so it cannot withhold the release;
        # this is what keeps that choice from becoming silence.
        with tempfile.TemporaryDirectory(prefix="nightly sentiment bug # ") as temp:
            out = self.run_sentiment(
                Path(temp),
                "import json\n"
                "print(json.dumps({'assessed': 1, 'alert': 'our_bug', "
                "'our_bugs': ['https://a.bg/1']}))\n")
            self.assertEqual(out["proc"].returncode, 0, out["proc"].stderr)
            self.assertEqual(out["report"]["alerts"], [
                {"alert": "jev_sentiment_our_bug", "count": 1,
                 "urls": ["https://a.bg/1"]}])
            # ⚠️ And on the SUMMARY LINE — the file alone is read by nobody.
            summary = json.loads(out["proc"].stdout.strip().splitlines()[-1])
            self.assertEqual(summary["alerts"], ["jev_sentiment_our_bug"])

    def test_an_all_failed_sentiment_run_is_lifted_with_its_count(self):
        # How a host with no API key looks: every article failed, exit 0.
        with tempfile.TemporaryDirectory(prefix="nightly sentiment dead # ") as temp:
            out = self.run_sentiment(
                Path(temp),
                "import json\n"
                "print(json.dumps({'assessed': 7, 'failed': 7, 'crashed': 0, "
                "'alert': 'all_failed'}))\n")
            self.assertEqual(out["proc"].returncode, 0, out["proc"].stderr)
            self.assertEqual(out["report"]["alerts"], [
                {"alert": "jev_sentiment_all_failed", "count": 7}])

    def test_a_clean_run_has_an_empty_alert_list_and_none_on_the_summary(self):
        with tempfile.TemporaryDirectory(prefix="nightly sentiment ok # ") as temp:
            out = self.run_sentiment(
                Path(temp), "import json; print(json.dumps({'assessed': 2}))\n")
            self.assertEqual(out["report"]["alerts"], [])
            summary = json.loads(out["proc"].stdout.strip().splitlines()[-1])
            self.assertNotIn("alerts", summary)

    def test_an_invalid_sentiment_limit_is_refused_before_any_stage(self):
        with tempfile.TemporaryDirectory(prefix="nightly sentiment limit # ") as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            self.stub_runtime_scripts(runner)
            proc = self.run_runner_at(
                runner, "--skip-browser",
                env={**os.environ, "NEWS_JEV_SENTIMENT_LIMIT": "lots"})
            self.assertEqual(proc.returncode, 2)
            self.assertIn("NEWS_JEV_SENTIMENT_LIMIT", proc.stderr)
            self.assertFalse((root / "news/data/_nightly").exists()
                             and any((root / "news/data/_nightly").glob("*.json")))

    def test_the_sentiment_stage_is_independent_of_the_glm_probe(self):
        # A GLM outage says nothing about Jev; articles analysed earlier are
        # still owed their scales on this run.
        with tempfile.TemporaryDirectory(prefix="nightly sentiment probe # ") as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            source = runner.read_text(encoding="utf-8").replace(
                'stage probe_model python3 news/scripts/llm_client.py --model "$MODEL"',
                "stage probe_model python3 -c 'import json,sys; "
                "print(json.dumps({})); sys.exit(1)'")
            runner.write_text(source, encoding="utf-8")
            self.stub_runtime_scripts(runner)
            (runner.parent / "jev_ask.py").write_text(
                "import json; print(json.dumps({'assessed': 2}))\n",
                encoding="utf-8")
            self.write_acquisition_script(
                runner.parent / "save_all_direct.sh",
                json.dumps({"mode": "intake-report", "domains": 1, "alerts": []}))
            self.run_runner_at(runner, "--skip-browser", "--run-id", "p")
            report = json.loads((root / "news/data/_nightly/p.json").read_text(
                encoding="utf-8"))
            sentiment = next(s for s in report["stages"] if s["stage"] == "sentiment")
            self.assertEqual(sentiment["result"], {"assessed": 2})


if __name__ == "__main__":
    unittest.main()
