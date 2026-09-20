#!/usr/bin/env python3

import ast
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import build_standalone_bundle as bundle
from news.scripts import eval_runtime


def load_uploader():
    path = bundle.ROOT / "news/standalone/upload_to_gcs.py"
    spec = importlib.util.spec_from_file_location("news_upload_to_gcs", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


uploader = load_uploader()

PUBLICATION = {
    "version": 3,
    "run_id": "test-run",
    "generated_at": "2026-08-31T07:00:00Z",
    "data_base": "versions/test-run",
    "home_health_ready": True,
    "accepted_snapshot_records_sha256": None,
    "accepted_feedback_records_sha256": None,
    "bundle": {"sha256": "a" * 64, "files": 1, "bytes": 2,
               "inventory": [{"path": "home.json", "bytes": 2,
                              "sha256": "b" * 64}]},
}

STANDALONE_ENV = {
    "NEWS_EVAL_SELECTIONS_JSON": "[]",
    # A release gate exports the production root before invoking this suite.
    # The copied bundle tests must still exercise their own isolated tree.
    "NEWS_DEPLOY_ROOT": "",
}


def valid_report(run_id: str = "test-run") -> dict:
    stages = [
        {
            "stage": name,
            "exit": 0,
            "result": ({
                "mode": "home_health",
                "ready": True,
                "declared_selected_payload_matches": True,
                "eligibility_counts_verified": False,
                "health": {"ready": True},
            } if name == "home_health" else {}),
        }
        for name in uploader.EXPECTED_STAGES
    ]
    return {
        "run_id": run_id,
        "stages": stages,
        "failed_stages": [],
        "stages_run": len(stages),
        "stages_ok": len(stages),
    }


class StandaloneBundle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="news_box_")
        self.out = Path(self.temp.name) / "box"
        self.manifest = bundle.build(self.out, False)
        shutil.copy2(self.out / "config.env.example", self.out / "config.env")

    def tearDown(self):
        self.temp.cleanup()

    def test_bundle_is_complete_verified_and_refuses_overwrite(self):
        self.assertGreaterEqual(len(self.manifest["files"]), 30)
        for rel in ("run_hourly.sh", "upload_to_gcs.py",
                    "news/scripts/run_nightly.sh",
                    "news/scripts/app_data_inventory.py",
                    "news/scripts/eval_runtime.py",
                    "news/scripts/propose_eval_corrections.py",
                    "news/scripts/source_commons_images.py",
                    "news/scripts/harvest_browser.mjs",
                    "news/eval_contract/contract.json",
                    "news-functions/src/operator-cli.ts",
                    "news/prompts/analyze_schema.json",
                    "news/data/gazetteer.json"):
            self.assertTrue((self.out / rel).is_file(), rel)
        verify = subprocess.run(
            [sys.executable, str(self.out / "verify_bundle.py")],
            cwd=self.out, text=True, capture_output=True)
        self.assertEqual(verify.returncode, 0, verify.stderr + verify.stdout)
        with self.assertRaises(FileExistsError):
            bundle.build(self.out, False)

        common_words = self.out / "news/data/common_words.json"
        common_words.write_text('{"generated_at":"next-hour"}\n', encoding="utf-8")
        selections = self.out / "news/config/commons_image_selections.json"
        selection_data = json.loads(selections.read_text(encoding="utf-8"))
        selection_data["selections"].append({"editorial": "mutable"})
        selections.write_text(json.dumps(selection_data), encoding="utf-8")
        verify = subprocess.run(
            [sys.executable, str(self.out / "verify_bundle.py")],
            cwd=self.out, text=True, capture_output=True)
        self.assertEqual(verify.returncode, 0, verify.stderr + verify.stdout)

    def test_include_state_carries_valid_commons_cache(self):
        with tempfile.TemporaryDirectory() as source_temp:
            source_root = Path(source_temp)
            (source_root / "news/data").mkdir(parents=True)
            cache = source_root / "news/review/commons_candidates.json"
            cache.parent.mkdir(parents=True)
            cache.write_text(json.dumps({
                "version": 2, "items": [], "search_cache": {
                    "none": {"term": "None", "candidates": []},
                },
            }), encoding="utf-8")
            copied = bundle.include_state(self.out, source_root)
        self.assertEqual(copied, 1)
        saved = json.loads((
            self.out / "news/review/commons_candidates.json").read_text())
        self.assertEqual(saved["search_cache"]["none"]["candidates"], [])

    def test_manifest_validation_fails_closed(self):
        manifest_path = self.out / "bundle-manifest.json"
        manifest_path.write_text("{}\n", encoding="utf-8")
        empty = subprocess.run(
            [sys.executable, str(self.out / "verify_bundle.py")],
            cwd=self.out, text=True, capture_output=True)
        self.assertNotEqual(empty.returncode, 0)
        self.assertIn("unsupported_or_missing_version", empty.stdout)

        manifest = self.manifest.copy()
        manifest["files"] = {"../escape": "0" * 64}
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        traversal = subprocess.run(
            [sys.executable, str(self.out / "verify_bundle.py")],
            cwd=self.out, text=True, capture_output=True)
        self.assertNotEqual(traversal.returncode, 0)
        self.assertIn("invalid_file_entry", traversal.stdout)

    @mock.patch.dict(os.environ, STANDALONE_ENV)
    def test_hourly_dry_run_and_cron_are_self_contained(self):
        cron = subprocess.run(
            ["bash", str(self.out / "install_cron.sh"), "--print"],
            cwd=self.out, text=True, capture_output=True)
        self.assertEqual(cron.returncode, 0, cron.stderr)
        self.assertIn("0 * * * *", cron.stdout)
        self.assertIn(str(self.out / "run_hourly.sh"), cron.stdout)

        run = subprocess.run(
            ["bash", str(self.out / "run_hourly.sh"), "--dry-run"],
            cwd=self.out, text=True, capture_output=True, timeout=60)
        self.assertEqual(run.returncode, 0, run.stderr + run.stdout)
        lines = [json.loads(line) for line in run.stdout.splitlines()
                 if line.strip().startswith("{")]
        self.assertTrue(any(row.get("mode") == "news_hourly" for row in lines))
        combined = list((self.out / "var/reports").glob("*.json"))
        self.assertTrue(combined)


class DirectNewsFolder(unittest.TestCase):
    @mock.patch.dict(os.environ, STANDALONE_ENV)
    def test_every_sibling_a_bundled_script_imports_is_bundled_too(self):
        """⚠️ A hard `import` of a sibling that the manifest does not ship is
        a bundle that dies at import — on the unattended deployment nobody is
        watching — and NOTHING here noticed: the folder test below builds
        exactly that tree, runs verify_install.py, and never imports the
        saver. Caught for real when save_articles.py grew an unguarded
        `import failure_rules`, which is the acquisition half of the pipeline.

        Derived from the manifest's own files rather than a list, so the next
        new sibling is covered the day it is imported.
        """
        bundled = {rel for rel in bundle.RUNTIME_SCRIPTS + bundle.SEED_FILES}
        # What a bundled .py could import and expect to find beside it.
        names = {Path(rel).stem for rel in bundled if rel.endswith(".py")}
        missing = []
        for rel in sorted(bundled):
            if not rel.endswith(".py"):
                continue
            source = bundle.ROOT / rel
            if not source.is_file():
                continue
            tree = ast.parse(source.read_text(encoding="utf-8"), filename=rel)
            for node in ast.walk(tree):
                # `import x` / `from x import y`, absolute and top-level only
                # — a dotted or relative name is not a bare sibling.
                if isinstance(node, ast.Import):
                    imported = [a.name for a in node.names if "." not in a.name]
                elif isinstance(node, ast.ImportFrom):
                    imported = ([node.module] if node.module
                                and node.level == 0
                                and "." not in node.module else [])
                else:
                    continue
                for name in imported:
                    sibling = bundle.ROOT / "news" / "scripts" / f"{name}.py"
                    if sibling.is_file() and name not in names:
                        missing.append(f"{rel} imports {name}")
        self.assertEqual(missing, [], "bundled scripts import siblings the "
                                      "manifest does not ship: " + "; ".join(missing))

    @mock.patch.dict(os.environ, STANDALONE_ENV)
    def test_copied_news_folder_runs_without_repository_siblings(self):
        with tempfile.TemporaryDirectory(prefix="direct_news_") as td:
            news = Path(td) / "news"
            news.mkdir()
            runtime = [rel for rel in bundle.RUNTIME_SCRIPTS + bundle.SEED_FILES
                       if rel.startswith("news/")]
            for rel in runtime:
                source = bundle.ROOT / rel
                target = news / Path(rel).relative_to("news")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
            shutil.copytree(bundle.ROOT / "news/prompts", news / "prompts")
            shutil.copytree(bundle.ROOT / "news/eval_contract", news / "eval_contract")
            shutil.copytree(bundle.ROOT / "news/standalone", news / "standalone")
            for name in (
                "run_hourly.sh", "install_cron.sh", "install_launchd.sh",
                "setup.sh", "verify_install.py", "package.json", ".env.api.example",
                ".env.model.example", ".env.upload.example",
                ".env.pipeline.example", ".env.evals.example",
            ):
                shutil.copy2(bundle.ROOT / "news" / name, news / name)
            for name in ("api", "model", "upload", "pipeline", "evals"):
                shutil.copy2(news / f".env.{name}.example", news / f".env.{name}")
            (news / "app-data").mkdir()
            (news / "mentions").mkdir()

            verify = subprocess.run(
                [sys.executable, str(news / "verify_install.py")], cwd=news,
                text=True, capture_output=True)
            self.assertEqual(verify.returncode, 0, verify.stderr + verify.stdout)
            default_run = subprocess.run(
                ["bash", str(news / "run_hourly.sh"), "--dry-run"], cwd=news,
                text=True, capture_output=True, timeout=60)
            self.assertEqual(default_run.returncode, 0,
                             default_run.stderr + default_run.stdout)
            self.assertNotIn("command not found", default_run.stderr)
            default_rows = [json.loads(line) for line in default_run.stdout.splitlines()
                            if line.startswith("{")]
            upload = next(row for row in default_rows
                          if row.get("mode") == "news_gcs_upload")
            self.assertFalse(upload["public_enabled"])
            self.assertEqual([scope["name"] for scope in upload["scopes"]],
                             ["archive"])

            upload_env = news / ".env.upload"
            config = upload_env.read_text(encoding="utf-8")
            config = config.replace("NEWS_ENABLE_PUBLIC_UPLOAD=0",
                                    "NEWS_ENABLE_PUBLIC_UPLOAD=1")
            config = config.replace("NEWS_PUBLIC_GCS_URI=",
                                    "NEWS_PUBLIC_GCS_URI=gs://public/news/app-data")
            config = config.replace("NEWS_MENTIONS_GCS_URI=",
                                    "NEWS_MENTIONS_GCS_URI=gs://public/news/mentions")
            upload_env.write_text(config, encoding="utf-8")
            enabled_run = subprocess.run(
                ["bash", str(news / "run_hourly.sh"), "--dry-run"], cwd=news,
                text=True, capture_output=True, timeout=60)
            self.assertEqual(enabled_run.returncode, 0,
                             enabled_run.stderr + enabled_run.stdout)
            enabled_rows = [json.loads(line) for line in enabled_run.stdout.splitlines()
                            if line.startswith("{")]
            enabled_upload = next(row for row in enabled_rows
                                  if row.get("mode") == "news_gcs_upload")
            mentions = next(scope for scope in enabled_upload["scopes"]
                            if scope["name"] == "public_mentions")
            self.assertEqual(Path(mentions["source"]), news / "mentions")
            cron = subprocess.run(
                ["bash", str(news / "install_cron.sh"), "--print"], cwd=news,
                text=True, capture_output=True)
            self.assertEqual(cron.returncode, 0, cron.stderr)
            self.assertIn("0 * * * *", cron.stdout)
            self.assertIn(str(news / "run_hourly.sh"), cron.stdout)


class UploadPolicy(unittest.TestCase):
    @mock.patch.dict(os.environ, STANDALONE_ENV)
    def test_task_build_inventory_binds_changed_and_empty_eval_queues(self):
        with tempfile.TemporaryDirectory(prefix="news_eval_inventory_") as td:
            root = Path(td)
            app_data = root / "news/app-data"
            app_data.mkdir(parents=True)
            generated_at = "2026-08-31T07:00:00Z"
            (app_data / "home.json").write_text(json.dumps({
                "generated_at": generated_at,
                "home_health": {"ready": True},
            }), encoding="utf-8")
            (app_data / "stats.json").write_text(json.dumps({
                "generated_at": generated_at,
                "accepted_snapshot_records_sha256": None,
                "accepted_feedback_records_sha256": None,
            }), encoding="utf-8")
            stale_inventory = {
                "generated_at": generated_at,
                **uploader.tree_inventory(app_data),
            }
            runtime_config = eval_runtime.RuntimeConfig(
                mode="required",
                credential=Path("/private/eval.json"),
                operator_cli=Path("/private/operator-cli.js"),
                unavailable_reason=None,
                max_snapshot_age_hours=26,
                live_manifest_url=eval_runtime.LIVE_MANIFEST_URL,
            )
            queues = [
                {"task_count": 1, "tasks": [{"article_key": "a.bg/1"}]},
                {"task_count": 1, "tasks": [{"article_key": "b.bg/2"}]},
                {"task_count": 0, "tasks": []},
            ]
            previous = stale_inventory
            for queue in queues:
                def write_queue(*_args, **_kwargs):
                    queue_path = app_data / "evals/queue.json"
                    queue_path.parent.mkdir(parents=True, exist_ok=True)
                    queue_path.write_text(json.dumps(queue), encoding="utf-8")
                    return mock.Mock(
                        returncode=0,
                        stdout='{"mode":"news_eval_task_sync"}\n',
                        stderr="",
                    )

                with mock.patch(
                    "news.scripts.eval_runtime.runtime_config",
                    return_value=runtime_config,
                ), mock.patch(
                    "news.scripts.eval_runtime.subprocess.run",
                    side_effect=write_queue,
                ):
                    result, code = eval_runtime.task_build_operation(root)
                self.assertEqual(code, 0)
                final_inventory = result["publication_inventory"]
                stages = {
                    "bundles": {"result": stale_inventory},
                    "eval_task_build": {"result": result},
                }
                self.assertEqual(
                    uploader.expected_publication_inventory(stages),
                    final_inventory,
                )
                manifest = uploader.publication_manifest(
                    "hour-1", app_data, final_inventory, {"ready": True})
                self.assertEqual(manifest["bundle"]["sha256"],
                                 final_inventory["sha256"])
                with self.assertRaisesRegex(
                    ValueError, "pipeline bundle result"
                ):
                    uploader.publication_manifest(
                        "hour-1", app_data, previous, {"ready": True})
                previous = final_inventory

            broken_values = [
                None,
                {key: value for key, value in previous.items()
                 if key != "sha256"},
                {**previous, "sha256": None},
                {**previous, "sha256": "not-a-sha"},
            ]
            for broken in broken_values:
                with self.subTest(broken=broken):
                    broken_result = {"exit": 0}
                    if broken is not None:
                        broken_result["publication_inventory"] = broken
                    broken_stages = {
                        "bundles": {"result": stale_inventory},
                        "eval_task_build": {"result": broken_result},
                    }
                    with self.assertRaisesRegex(
                        ValueError, "omitted the final|malformed final"
                    ):
                        uploader.expected_publication_inventory(broken_stages)

    def test_archive_versioning_parser(self):
        self.assertTrue(uploader.versioning_enabled(
            "gs://private-bucket: Enabled"))
        self.assertFalse(uploader.versioning_enabled(
            "gs://private-bucket: Suspended"))

    def test_production_uploader_rejects_placeholder_destination(self):
        script = bundle.ROOT / "news/standalone/upload_to_gcs.py"
        env = {**os.environ, "DATA_BG_ROOT": str(bundle.ROOT),
               "NEWS_ENABLE_PUBLIC_UPLOAD": "0",
               "NEWS_ARCHIVE_GCS_URI": "gs://REPLACE_ME_PRIVATE/news/archive",
               "NEWS_PUBLIC_GCS_URI": "", "NEWS_MENTIONS_GCS_URI": ""}
        proc = subprocess.run(
            [sys.executable, str(script), "--archive-only"], env=env,
            text=True, capture_output=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("contains REPLACE_ME", proc.stdout)

    def test_report_gate_and_upload_scopes(self):
        with tempfile.TemporaryDirectory(prefix="news_upload_") as td:
            report = Path(td) / "report.json"
            report.write_text(json.dumps(valid_report()), encoding="utf-8")
            self.assertEqual(
                uploader.load_report(report, "test-run"), (True, "ready"))
            failed = valid_report()
            next(
                stage for stage in failed["stages"]
                if stage["stage"] == "mention_index"
            )["exit"] = 1
            failed["failed_stages"] = ["mention_index"]
            failed["stages_ok"] = len(failed["stages"]) - 1
            report.write_text(json.dumps(failed), encoding="utf-8")
            ready, reason = uploader.load_report(report)
            self.assertFalse(ready)
            self.assertIn("mention_index", reason)
            truncated = valid_report()
            truncated["stages"] = truncated["stages"][-2:]
            report.write_text(json.dumps(truncated), encoding="utf-8")
            ready, reason = uploader.load_report(report)
            self.assertFalse(ready)
            self.assertIn("incomplete", reason)
            report.write_text(json.dumps(valid_report()), encoding="utf-8")
            ready, reason = uploader.load_report(report, "different-run")
            self.assertFalse(ready)
            self.assertIn("run_id mismatch", reason)

            invalid_health = valid_report()
            invalid_health["stages"][-1]["result"] = {}
            report.write_text(json.dumps(invalid_health), encoding="utf-8")
            ready, reason = uploader.load_report(report)
            self.assertFalse(ready)
            self.assertIn("invalid home_health verdict", reason)

    def test_public_delete_scope_rejects_bucket_root(self):
        with mock.patch.dict(os.environ, {
            "NEWS_PUBLIC_GCS_URI": "gs://public-bucket",
            "NEWS_MENTIONS_GCS_URI": "gs://public-bucket/news/mentions",
            "NEWS_ARCHIVE_GCS_URI": "gs://private-bucket/news/archive",
        }, clear=False):
            with self.assertRaisesRegex(ValueError, "non-empty prefix"):
                uploader.commands(True, True, PUBLICATION)

    def test_a_failed_pipeline_refuses_the_PUBLIC_publish_only(self):
        """A stage that aborted must not move readers onto its release.

        Measured 2026-09-02: `analyze` exited 2 on its canary (the model
        server ignored the schema) and the run still advanced the manifest,
        because the uploader was never told the pipeline had failed. The
        ARCHIVE is deliberately still written — it is a private durable
        backup, and a failed run is when its raw data is most worth keeping.
        """
        base = {
            "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive",
            "NEWS_PUBLIC_GCS_URI": "gs://public/news/app-data",
            "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
            "NEWS_ENABLE_PUBLIC_UPLOAD": "1",
        }
        with mock.patch.dict(os.environ, base, clear=False):
            healthy = uploader.commands(
                True, uploader.public_upload_enabled(), PUBLICATION)
            refused = uploader.commands(
                False, uploader.public_upload_enabled(), PUBLICATION)
        self.assertEqual([s["name"] for s in refused], ["archive"])
        self.assertIn("public_app_data_manifest", [s["name"] for s in healthy])

    def test_the_uploader_accepts_and_honours_a_pipeline_exit_code(self):
        """The flag must exist and be wired to public_ready, not merely parsed."""
        source = Path(uploader.__file__).read_text(encoding="utf-8")
        self.assertIn("--pipeline-exit", source)
        self.assertIn("pipeline_failed", source)
        # It must gate public_ready; parsing it and ignoring it would pass a
        # presence-only check while publishing exactly as before.
        self.assertRegex(
            source,
            r"if args\.pipeline_exit:\s*\n\s*public_ready, reason = False")

    def test_run_hourly_tells_the_uploader_the_pipeline_exit_code(self):
        """The gate is useless if the caller never passes the fact."""
        script = (Path(uploader.__file__).parent / "run_hourly.sh").read_text(
            encoding="utf-8")
        self.assertIn("--pipeline-exit", script)
        self.assertIn('UPLOAD_ARGS+=(--pipeline-exit "$PIPELINE_CODE")', script)

    def test_mentions_scope_uses_gcloud_storage_not_gsutil(self):
        """The mentions rsync must not run on gsutil.

        It is the one scope pairing rsync (which checksums each candidate
        against the object already in the bucket) with gzip, and gsutil takes a
        pure-Python CRC path for that comparison when crcmod's C extension is
        missing -- Python 2 code that dies on `sys.maxint`. Measured 2026-09-02
        against the live bucket, that left 58 mention files unpublished while
        reporting "1 files/objects could not be copied", so the count in the
        failure cannot be trusted either.

        The other two transfer scopes stay on gsutil deliberately, and this
        pins that too: `public_app_data_version` depends on
        `x-goog-if-generation-match:0` to refuse overwriting an immutable
        release, which is not the same guarantee under another tool.
        """
        base = {
            "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive",
            "NEWS_PUBLIC_GCS_URI": "gs://public/news/app-data",
            "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
            "NEWS_ENABLE_PUBLIC_UPLOAD": "1",
        }
        with mock.patch.dict(os.environ, base, clear=False):
            scopes = {scope["name"]: scope for scope in
                      uploader.commands(True, uploader.public_upload_enabled(),
                                        PUBLICATION)}
        mentions = scopes["public_mentions"]
        self.assertEqual(mentions["argv"][:3], ["gcloud", "storage", "rsync"])
        self.assertNotIn("gsutil", mentions["argv"])
        # Same semantics the gsutil form had: recurse, delete unmatched
        # destination objects, gzip json in flight.
        self.assertIn("--recursive", mentions["argv"])
        self.assertIn("--delete-unmatched-destination-objects", mentions["argv"])
        self.assertIn("--gzip-in-flight=json", mentions["argv"])
        self.assertTrue(mentions["deletes_remote"])
        # The deleting flag and the declared intent must agree, in both
        # directions -- a scope that deletes without declaring it escapes the
        # disjointness guard that keeps it off the app-data prefix.
        for scope in scopes.values():
            deletes = ("--delete-unmatched-destination-objects" in scope["argv"]
                       or "-d" in scope["argv"])
            self.assertEqual(deletes, scope["deletes_remote"], scope["name"])
        # One definition of the cache value, shared with the gsutil header.
        self.assertIn(f"--cache-control={uploader.MUTABLE_PUBLIC_CACHE_VALUE}",
                      mentions["argv"])
        self.assertTrue(
            uploader.MUTABLE_PUBLIC_CACHE.endswith(
                uploader.MUTABLE_PUBLIC_CACHE_VALUE))
        # The immutable-release scope keeps its generation precondition.
        self.assertEqual(scopes["public_app_data_version"]["argv"][0], "gsutil")
        self.assertIn("x-goog-if-generation-match:0",
                      scopes["public_app_data_version"]["argv"])
        self.assertEqual(scopes["archive"]["argv"][0], "gsutil")

    def test_public_upload_is_opt_in_and_delete_scopes_are_disjoint(self):
        base = {
            "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive",
            "NEWS_PUBLIC_GCS_URI": "gs://public/news/app-data",
            "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
        }
        with mock.patch.dict(os.environ, {**base,
                                          "NEWS_ENABLE_PUBLIC_UPLOAD": "0"},
                             clear=False):
            self.assertEqual([row["name"] for row in
                              uploader.commands(True, uploader.public_upload_enabled())],
                             ["archive"])
        with mock.patch.dict(os.environ, {**base,
                                          "NEWS_ENABLE_PUBLIC_UPLOAD": "1"},
                             clear=False):
            scopes = uploader.commands(
                True, uploader.public_upload_enabled(), PUBLICATION)
            self.assertEqual([scope["name"] for scope in scopes], [
                "archive", "public_app_data_version",
                "public_app_data_version_meta", "public_mentions",
                "public_app_data_manifest",
            ])
            self.assertEqual(
                scopes[1]["destination"],
                "gs://public/news/app-data/versions/test-run")
            self.assertTrue(any("max-age=31536000" in arg
                                for arg in scopes[1]["argv"]))
            self.assertIn("x-goog-if-generation-match:0", scopes[1]["argv"])
            self.assertNotIn("rsync", scopes[1]["argv"])
            self.assertEqual(
                scopes[-1]["destination"],
                "gs://public/news/app-data/manifest.json")
            self.assertTrue(any("no-cache" in arg
                                for arg in scopes[-1]["argv"]))
            self.assertFalse(uploader.same_or_nested_scope(
                base["NEWS_PUBLIC_GCS_URI"], base["NEWS_MENTIONS_GCS_URI"]))
            self.assertTrue(uploader.same_or_nested_scope(
                "gs://public/news", "gs://public/news/mentions"))
            self.assertFalse(uploader.same_or_nested_scope(
                "gs://public/news/a", "gs://public/news/ab"))

            public_only = uploader.public_app_data_scopes(scopes)
            self.assertEqual([scope["name"] for scope in public_only], [
                "public_app_data_version", "public_app_data_version_meta",
                "public_app_data_manifest",
            ])
            self.assertTrue(all(
                scope["deletes_remote"] is False for scope in public_only))

            with mock.patch.object(
                    uploader, "run_scope",
                    return_value={"name": "archive", "exit": 1}):
                results = uploader.execute_scopes(scopes, False)
            self.assertEqual(len(results), len(scopes))
            for skipped in results[1:]:
                self.assertEqual(skipped["skipped"],
                                 "previous_scope_failed:archive")

    def test_the_version_tree_is_stored_gzipped_and_the_manifest_is_not(self):
        # -j only compressed the upload; `-z json` stores Content-Encoding:
        # gzip, which every reader of every release then downloads (plan
        # §0.3 V1). The manifest stays identity: it is tiny, and the
        # staleness check and eval operator read it directly.
        base = {
            "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive",
            "NEWS_PUBLIC_GCS_URI": "gs://public/news/app-data",
            "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
        }
        with mock.patch.dict(os.environ, base, clear=False):
            listed = uploader.commands(True, True, PUBLICATION)
            app_only = [s["name"] for s in
                        uploader.public_app_data_scopes(listed)]
        scopes = {s["name"]: s for s in listed}
        # The app-data-only publish must carry the reset too.
        self.assertEqual(app_only, ["public_app_data_version",
                                    "public_app_data_version_meta",
                                    "public_app_data_manifest"])
        version = scopes["public_app_data_version"]["argv"]
        self.assertIn("-z", version)
        self.assertEqual(version[version.index("-z") + 1], "json")
        self.assertNotIn("-j", version)
        manifest = scopes["public_app_data_manifest"]["argv"]
        self.assertNotIn("-z", manifest)
        self.assertNotIn("-Z", manifest)
        # cp -z appends `no-transform`, which disables GCS transcoding for
        # clients without Accept-Encoding; the setmeta scope resets it, and
        # must run after the version upload and before the manifest.
        order = [s["name"] for s in listed]
        self.assertLess(order.index("public_app_data_version"),
                        order.index("public_app_data_version_meta"))
        self.assertLess(order.index("public_app_data_version_meta"),
                        order.index("public_app_data_manifest"))
        meta = scopes["public_app_data_version_meta"]["argv"]
        self.assertEqual(meta[:3], ["gsutil", "-m", "setmeta"])
        self.assertIn(uploader.IMMUTABLE_PUBLIC_CACHE, meta)
        self.assertNotIn("no-transform", uploader.IMMUTABLE_PUBLIC_CACHE)
        self.assertTrue(meta[-1].endswith("/versions/test-run/**"))

    def test_manifest_is_last_and_never_advances_after_version_failure(self):
        base = {
            "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive",
            "NEWS_PUBLIC_GCS_URI": "gs://public/news/app-data",
            "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
        }
        with mock.patch.dict(os.environ, base, clear=False):
            scopes = uploader.commands(True, True, PUBLICATION)
        outcomes = [
            {"name": "archive", "exit": 0},
            {"name": "public_app_data_version", "exit": 1},
        ]
        with mock.patch.object(uploader, "run_scope", side_effect=outcomes):
            results = uploader.execute_scopes(scopes, False)
        self.assertEqual(
            results[-1]["skipped"],
            "previous_scope_failed:public_app_data_version")
        self.assertEqual(results[-1]["name"], "public_app_data_manifest")
        # Every scope that RAN carries its wall time (the perf log's
        # `publish` events); one that was skipped did not run.
        for ran in results[:2]:
            self.assertIsInstance(ran["seconds"], float)
        self.assertNotIn("seconds", results[-1])

    def test_publication_manifest_is_tied_to_a_healthy_home_payload(self):
        with tempfile.TemporaryDirectory(prefix="news_manifest_") as td:
            app_data = Path(td)
            (app_data / "home.json").write_text(json.dumps({
                "generated_at": "2026-08-31T07:00:00Z",
                "home_health": {"ready": True},
            }), encoding="utf-8")
            (app_data / "stats.json").write_text(json.dumps({
                "generated_at": "2026-08-31T07:00:00Z",
                "accepted_snapshot_records_sha256": "c" * 64,
                "accepted_feedback_records_sha256": "sha256:" + "d" * 64,
            }), encoding="utf-8")
            manifest = uploader.publication_manifest("hour-1", app_data)
            self.assertEqual(manifest["version"], 3)
            self.assertEqual(
                manifest["accepted_snapshot_records_sha256"], "c" * 64)
            self.assertEqual(
                manifest["accepted_feedback_records_sha256"], "d" * 64)
            self.assertEqual(manifest["run_id"], "hour-1")
            self.assertEqual(manifest["data_base"], "versions/hour-1")
            self.assertEqual(manifest["bundle"]["files"], 2)
            self.assertEqual(len(manifest["bundle"]["sha256"]), 64)
            self.assertEqual(manifest["bundle"]["inventory"][0]["path"],
                             "home.json")
            rebound = uploader.publication_manifest("hour-1", app_data, {
                "generated_at": "2026-08-31T07:00:00Z",
                "files": manifest["bundle"]["files"],
                "bytes": manifest["bundle"]["bytes"],
            }, {"ready": True})
            self.assertEqual(rebound["bundle"], manifest["bundle"])
            with self.assertRaisesRegex(ValueError, "safe for a version path"):
                uploader.publication_manifest("../escape", app_data)
            with self.assertRaisesRegex(ValueError, "pipeline bundle result"):
                uploader.publication_manifest("hour-1", app_data, {
                    "generated_at": "2026-08-31T06:00:00Z",
                    "files": 1,
                    "bytes": manifest["bundle"]["bytes"],
                })
            for invalid in ("2026-08-31", "2026-08-31T07:00:00", "not-a-date"):
                (app_data / "home.json").write_text(json.dumps({
                    "generated_at": invalid,
                    "home_health": {"ready": True},
                }), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "timezone-aware"):
                    uploader.publication_manifest("hour-1", app_data)
            (app_data / "home.json").write_text(json.dumps({
                "generated_at": "2026-08-31T07:00:00Z",
                "home_health": {"ready": False},
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "health is not ready"):
                uploader.publication_manifest("hour-2", app_data)
            (app_data / "home.json").write_text(json.dumps({
                "generated_at": "2026-08-31T07:00:00Z",
                "home_health": {"ready": True},
            }), encoding="utf-8")
            (app_data / "stats.json").write_text(json.dumps({
                "generated_at": "2026-08-31T07:00:00Z",
                "accepted_snapshot_records_sha256": "not-a-hash",
                "accepted_feedback_records_sha256": None,
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "invalid accepted snapshot hash"):
                uploader.publication_manifest("hour-2", app_data)
            (app_data / "stats.json").write_text(json.dumps({
                "generated_at": "2026-08-31T07:00:00Z",
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "provenance is missing"):
                uploader.publication_manifest("hour-2", app_data)
            (app_data / "stats.json").write_text(json.dumps({
                "generated_at": "2026-08-31T07:00:00Z",
                "accepted_snapshot_records_sha256": None,
                "accepted_feedback_records_sha256": None,
            }), encoding="utf-8")
            self.assertIsNone(
                uploader.publication_manifest("hour-2", app_data)
                ["accepted_snapshot_records_sha256"])

    def test_snapshot_detects_a_changing_source_tree(self):
        inventory = {"sha256": "a" * 64, "files": 1, "bytes": 2,
                     "inventory": []}
        changed = {**inventory, "sha256": "b" * 64}
        with tempfile.TemporaryDirectory(prefix="news_snapshot_") as td:
            source = Path(td) / "source"
            destination = Path(td) / "snapshot"
            source.mkdir()
            (source / "home.json").write_text("{}", encoding="utf-8")
            with mock.patch.object(
                    uploader, "tree_inventory",
                    side_effect=[inventory, inventory, changed]):
                with self.assertRaisesRegex(ValueError, "changed while"):
                    uploader.materialize_snapshot(source, destination)

    def test_manifest_activation_is_generation_guarded_and_monotonic(self):
        base = {
            "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive",
            "NEWS_PUBLIC_GCS_URI": "gs://public/news/app-data",
            "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
        }
        with mock.patch.dict(os.environ, base, clear=False):
            scope = uploader.commands(True, True, PUBLICATION)[-1]
        older = {**PUBLICATION, "run_id": "old-run",
                 "data_base": "versions/old-run",
                 "generated_at": "2026-08-31T06:00:00Z"}
        with mock.patch.object(uploader, "remote_manifest",
                               return_value=(older, 42)), \
             mock.patch.object(uploader.subprocess, "run",
                               return_value=mock.Mock(returncode=0)) as run:
            result = uploader.run_scope(scope, False)
        self.assertEqual(result["exit"], 0)
        actual = run.call_args.args[0]
        self.assertIn("x-goog-if-generation-match:42", actual)

        newer = {**PUBLICATION, "run_id": "new-run",
                 "data_base": "versions/new-run",
                 "generated_at": "2026-08-31T08:00:00Z"}
        with mock.patch.object(uploader, "remote_manifest",
                               return_value=(newer, 43)), \
             mock.patch.object(uploader.subprocess, "run") as refused:
            result = uploader.run_scope(scope, False)
        self.assertEqual(result["error"], "stale_publication_refused")
        refused.assert_not_called()

    def test_remote_manifest_generation_conflict_fails_activation(self):
        base = {
            "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive",
            "NEWS_PUBLIC_GCS_URI": "gs://public/news/app-data",
            "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
        }
        with mock.patch.dict(os.environ, base, clear=False):
            scope = uploader.commands(True, True, PUBLICATION)[-1]
        with mock.patch.object(uploader, "remote_manifest",
                               return_value=(None, 0)), \
             mock.patch.object(uploader.subprocess, "run",
                               return_value=mock.Mock(returncode=1)):
            result = uploader.run_scope(scope, False)
        self.assertEqual(result["exit"], 1)

    def _empty_root(self) -> str:
        """An EMPTY root, not the repo: the policy tests check bucket
        configuration, and the repo's live news/app-data makes the dry run
        build a real manifest first — which fails whenever the pipeline last
        produced a not-ready home payload (first seen after the 2026-09-19
        22:00 run)."""
        root = tempfile.mkdtemp(prefix="news_root_")
        self.addCleanup(shutil.rmtree, root, True)
        return root

    def test_archive_and_public_bucket_must_differ(self):
        script = bundle.ROOT / "news/standalone/upload_to_gcs.py"
        env = {**os.environ, "DATA_BG_ROOT": self._empty_root(),
               "NEWS_ENABLE_PUBLIC_UPLOAD": "1",
               "NEWS_PUBLIC_GCS_URI": "gs://same/news/app-data",
               "NEWS_MENTIONS_GCS_URI": "gs://same/news/mentions",
               "NEWS_ARCHIVE_GCS_URI": "gs://same/private/archive"}
        with tempfile.TemporaryDirectory(prefix="news_report_") as td:
            report = Path(td) / "report.json"
            report.write_text(json.dumps(valid_report()), encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, str(script), "--dry-run", "--report", str(report)],
                env=env, text=True, capture_output=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("different private bucket", proc.stdout)

        archive_only = subprocess.run(
            [sys.executable, str(script), "--dry-run", "--archive-only"],
            env=env, text=True, capture_output=True)
        self.assertEqual(archive_only.returncode, 2)
        self.assertIn("different private bucket", archive_only.stdout)

    def test_nested_public_delete_scopes_are_rejected(self):
        script = bundle.ROOT / "news/standalone/upload_to_gcs.py"
        env = {**os.environ, "DATA_BG_ROOT": self._empty_root(),
               "NEWS_ENABLE_PUBLIC_UPLOAD": "1",
               "NEWS_PUBLIC_GCS_URI": "gs://public/news",
               "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
               "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive"}
        with tempfile.TemporaryDirectory(prefix="news_report_") as td:
            report = Path(td) / "report.json"
            report.write_text(json.dumps(valid_report()), encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, str(script), "--dry-run", "--report", str(report)],
                env=env, text=True, capture_output=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("must be disjoint", proc.stdout)


OVERLAY = {
    "schema_version": 1,
    "seq": 1,
    "base_run_id": "test-run",
    "generated_at": "2026-08-31T07:05:00Z",
    "release_generated_at": "2026-08-31T07:05:00Z",
    "latest_limit": 150,
    "articles": {},
    "removed_article_urls": {},
    "removed_domains": [],
    "bundle_envelopes": {},
    "story_details": {},
    "removed_story_ids": [],
    "home": None,
    "replaced_paths": {},
    "removed_paths": [],
}


class HotRelease(unittest.TestCase):
    """Plan §4.6(d) — publishing an overlay against the LIVE release.

    ⚠️ A HOT RELEASE IS A SECOND MANIFEST FOR ONE run_id, which is the
    exact thing the publisher refuses in order to stop a re-run silently
    redefining a release readers already hold. So the door through that
    rule is a whitelist, and most of this class is about what must not get
    through it.
    """

    def write_overlay(self, **patch) -> Path:
        temp = tempfile.mkdtemp(prefix="news_overlay_scope_")
        self.addCleanup(shutil.rmtree, temp, True)
        path = Path(temp) / "1.json"
        path.write_text(json.dumps({**OVERLAY, **patch}, ensure_ascii=False),
                        encoding="utf-8")
        return path

    @mock.patch.dict(os.environ, {**STANDALONE_ENV,
                                  "NEWS_PUBLIC_GCS_URI": "gs://pub/news"})
    def test_it_publishes_exactly_two_objects_and_the_pointer_is_last(self):
        # ⚠️ The whole justification: a cold release is ~2,100 objects and
        # 96 s. And the ORDER is the commit — the manifest is last, so a
        # reader only ever learns about an object already there.
        scopes, publication = uploader.overlay_commands(
            self.write_overlay(), PUBLICATION, "2026-08-31T07:05:00Z")
        self.assertEqual([scope["name"] for scope in scopes],
                         ["public_app_data_overlay", "public_app_data_manifest"])
        self.assertEqual(scopes[0]["destination"],
                         "gs://pub/news/versions/test-run/overlays/1.json")
        self.assertTrue(all(scope["deletes_remote"] is False
                            for scope in scopes))
        # Same release, one more object beside it.
        self.assertEqual(publication["run_id"], PUBLICATION["run_id"])
        self.assertEqual(publication["bundle"], PUBLICATION["bundle"])
        self.assertEqual(publication["overlay"]["seq"], 1)

    @mock.patch.dict(os.environ, {**STANDALONE_ENV,
                                  "NEWS_PUBLIC_GCS_URI": "gs://pub/news"})
    def test_the_overlay_object_is_create_only_and_stored_gzip(self):
        # ⚠️ Create-only, so a repeated seq COLLIDES rather than rewriting
        # a view some reader is already merging.
        scopes, _ = uploader.overlay_commands(
            self.write_overlay(), PUBLICATION, "2026-08-31T07:05:00Z")
        argv = scopes[0]["argv"]
        self.assertIn("x-goog-if-generation-match:0", argv)
        self.assertIn("-z", argv)
        self.assertIn(uploader.IMMUTABLE_PUBLIC_CACHE, argv)

    @mock.patch.dict(os.environ, {**STANDALONE_ENV,
                                  "NEWS_PUBLIC_GCS_URI": "gs://pub/news"})
    def test_an_overlay_built_against_another_release_is_refused(self):
        # ⚠️ THE REFUSAL THAT MATTERS MOST. A delta from a different base
        # merges cleanly and lands every reader on a view that never
        # existed — nothing errors, nothing looks wrong.
        with self.assertRaisesRegex(ValueError, "was built against"):
            uploader.overlay_commands(
                self.write_overlay(base_run_id="some-other-run"),
                PUBLICATION, "2026-08-31T07:05:00Z")

    @mock.patch.dict(os.environ, {**STANDALONE_ENV,
                                  "NEWS_PUBLIC_GCS_URI": "gs://pub/news"})
    def test_a_hot_release_keeps_the_base_revision(self):
        # ⚠️ `generated_at` IS THE RELEASE REVISION — `publication_manifest`
        # takes it from home.json, and four consumers compare something
        # against it. A hot release re-stamping it with its own wall clock
        # would make the manifest disagree with the tree it points at,
        # which is the defect that cost two hours of publication and then
        # stalled the feedback sync, reintroduced from the other side.
        _scopes, publication = uploader.overlay_commands(
            self.write_overlay(), PUBLICATION, "2026-09-01T00:00:00Z")
        self.assertEqual(publication["generated_at"],
                         PUBLICATION["generated_at"])
        self.assertEqual(
            {k for k in publication if publication[k] != PUBLICATION.get(k)},
            {"overlay"}, "a hot release moved more than the overlay")

    @mock.patch.dict(os.environ, {**STANDALONE_ENV,
                                  "NEWS_PUBLIC_GCS_URI": "gs://pub/news"})
    def test_the_pointer_describes_the_file_that_was_read(self):
        path = self.write_overlay()
        _scopes, publication = uploader.overlay_commands(
            path, PUBLICATION, "2026-08-31T07:05:00Z")
        pointer = publication["overlay"]
        self.assertEqual(pointer["bytes"], path.stat().st_size)
        self.assertEqual(pointer["path"], "overlays/1.json")
        # The UNCOMPRESSED hash, as the bundle inventory is — the object is
        # stored gzip and a reader verifies the decoded body.
        import hashlib
        self.assertEqual(pointer["sha256"],
                         hashlib.sha256(path.read_bytes()).hexdigest())


    @mock.patch.dict(os.environ, {**STANDALONE_ENV,
                                  "NEWS_PUBLIC_GCS_URI": "gs://pub/news"})
    def test_the_overlay_scope_actually_runs(self):
        # ⚠️ IT DID NOT. Every cold scope uploads a TREE, so `run_scope`
        # asked whether the source was a DIRECTORY — and the overlay, which
        # is one object, was refused as a missing source directory before a
        # byte was sent. Every unit test above still passed, because none
        # of them executed a scope.
        scopes, _ = uploader.overlay_commands(
            self.write_overlay(), PUBLICATION, "2026-08-31T07:05:00Z")
        calls = []

        class Done:
            returncode = 0

        with mock.patch.object(uploader.subprocess, "run",
                               side_effect=lambda argv, **kw: (
                                   calls.append(argv), Done())[1]):
            result = uploader.run_scope(scopes[0], dry_run=False)
        self.assertEqual(result["exit"], 0, result)
        self.assertNotIn("error", result)
        self.assertEqual(calls[0], scopes[0]["argv"])

    @mock.patch.dict(os.environ, {**STANDALONE_ENV,
                                  "NEWS_PUBLIC_GCS_URI": "gs://pub/news"})
    def test_a_missing_overlay_file_fails_the_scope(self):
        scopes, _ = uploader.overlay_commands(
            self.write_overlay(), PUBLICATION, "2026-08-31T07:05:00Z")
        scopes[0]["source"] = Path("/nonexistent/overlay.json")
        result = uploader.run_scope(scopes[0], dry_run=False)
        self.assertEqual(result["exit"], 2)
        self.assertEqual(result["error"], "source_missing")


class HotPredicate(unittest.TestCase):
    """`overlay_advance` — the only door through one-manifest-per-release."""

    def candidate(self, **patch) -> dict:
        # ⚠️ The base's `generated_at`, UNCHANGED. A hot release moves
        # exactly one field — `overlay` — because `generated_at` is the
        # release revision four consumers compare against.
        return {**PUBLICATION,
                "overlay": {"seq": 1, "path": "overlays/1.json",
                            "bytes": 10, "sha256": "c" * 64,
                            "base_generated_at": "2026-08-31T07:00:00Z"},
                **patch}

    def test_an_added_overlay_is_admitted(self):
        self.assertIsNone(uploader.overlay_advance(PUBLICATION, self.candidate()))

    def test_every_field_describing_the_TREE_is_refused(self):
        # ⚠️ A whitelist, not a blacklist: a release is immutable once
        # readers hold it, and the only thing a hot publish adds is a
        # pointer to an object that did not exist before. Any other field
        # moving means the tree changed, which a hot release cannot do.
        for field, value in (
                ("bundle", {"sha256": "z" * 64, "files": 1, "bytes": 2,
                            "inventory": []}),
                ("data_base", "versions/elsewhere"),
                ("version", 2),
                ("home_health_ready", False),
                ("accepted_snapshot_records_sha256", "d" * 64),
                ("accepted_feedback_records_sha256", "e" * 64)):
            with self.subTest(field=field):
                refusal = uploader.overlay_advance(
                    PUBLICATION, self.candidate(**{field: value}))
                self.assertEqual(refusal,
                                 f"publication_id_already_used:{field}")

    def test_a_moved_revision_is_refused_even_with_a_good_overlay(self):
        # ⚠️ TWO DOORS, AND BOTH MUST BE SHUT. `overlay_commands` keeps the
        # base's `generated_at`, but the CAS is what a manifest written by
        # anything else goes through — so the predicate has to refuse a
        # moved revision on its own. `generated_at` is THE release
        # revision: four consumers compare something against it, and a
        # manifest claiming one the tree does not carry is the defect that
        # cost two hours of publication.
        self.assertEqual(
            uploader.overlay_advance(
                PUBLICATION,
                self.candidate(generated_at="2026-08-31T09:00:00Z")),
            "publication_id_already_used:generated_at")

    def test_a_candidate_with_no_overlay_is_refused(self):
        # Otherwise a plain re-publish of the same run_id with a new
        # timestamp would walk straight through.
        candidate = self.candidate()
        del candidate["overlay"]
        self.assertEqual(uploader.overlay_advance(PUBLICATION, candidate),
                         "publication_id_already_used")

    def test_the_sequence_must_strictly_advance(self):
        # ⚠️ Overlays are CUMULATIVE, not a chain — a reader merges the
        # base plus the LATEST one. Going backwards points every reader at
        # an older view of the same release with no way to tell.
        live = {**PUBLICATION, "overlay": {"seq": 4}}
        for seq in (4, 3, 0, -1):
            with self.subTest(seq=seq):
                candidate = self.candidate()
                candidate["overlay"] = {**candidate["overlay"], "seq": seq}
                self.assertEqual(uploader.overlay_advance(live, candidate),
                                 "overlay_sequence_did_not_advance")
        candidate = self.candidate()
        candidate["overlay"] = {**candidate["overlay"], "seq": 5}
        self.assertIsNone(uploader.overlay_advance(live, candidate))

    def test_a_malformed_live_pointer_refuses_rather_than_assuming_zero(self):
        live = {**PUBLICATION, "overlay": {"seq": "4"}}
        self.assertEqual(
            uploader.overlay_advance(live, self.candidate()),
            "overlay_live_pointer_malformed")

    def test_the_manifest_CAS_admits_a_hot_candidate_and_only_that(self):
        # ⚠️ THE INTEGRATION, not the predicate. `run_scope`'s manifest
        # branch is where the "one manifest per run_id" refusal lives, and
        # a predicate that is right while the branch never calls it buys
        # nothing.
        scope = {"name": "public_app_data_manifest",
                 "source": uploader.MANIFEST_SOURCE,
                 "destination": "gs://pub/news/manifest.json",
                 "deletes_remote": False,
                 "argv": ["gsutil", "cp", uploader.MANIFEST_SOURCE,
                          "gs://pub/news/manifest.json"],
                 "content": json.dumps(self.candidate())}

        class Done:
            returncode = 0

        with mock.patch.object(uploader, "remote_manifest",
                               return_value=(PUBLICATION, 7)), \
                mock.patch.object(uploader.subprocess, "run",
                                  return_value=Done()):
            admitted = uploader.run_scope(scope, dry_run=False)
        self.assertEqual(admitted["exit"], 0, admitted)

        # …and the same branch still refuses a re-publish that is not one.
        rejected_content = json.dumps(
            {**PUBLICATION, "generated_at": "2026-08-31T09:00:00Z"})
        with mock.patch.object(uploader, "remote_manifest",
                               return_value=(PUBLICATION, 7)):
            rejected = uploader.run_scope(
                {**scope, "content": rejected_content}, dry_run=False)
        self.assertEqual(rejected["exit"], 3)
        self.assertTrue(
            rejected["error"].startswith("publication_id_already_used"),
            rejected)

    def test_a_cold_release_landing_mid_run_refuses_the_hot_publish(self):
        # ⚠️ THE RACE THAT ROLLS A RELEASE BACKWARDS. A hot run reads the
        # live manifest, spends ~40 s building, then writes. If a COLD
        # release lands in that window the run_ids differ, the overlay
        # predicate is skipped, and the only remaining guard compares this
        # run's WALL CLOCK against the cold release's BUILD time — which a
        # hot run wins. Without the write-time check the manifest goes
        # BACK to the previous release, silently, costing every reader two
        # full cache clears.
        landed = {**PUBLICATION, "run_id": "later-run",
                  "data_base": "versions/later-run",
                  "generated_at": "2026-08-31T08:00:00Z"}
        scope = {"name": "public_app_data_manifest",
                 "source": uploader.MANIFEST_SOURCE,
                 "destination": "gs://pub/news/manifest.json",
                 "deletes_remote": False, "hot": True,
                 "argv": ["gsutil", "cp", uploader.MANIFEST_SOURCE,
                          "gs://pub/news/manifest.json"],
                 # Later than the cold release's BUILD stamp, which is
                 # what made the old guard let this through.
                 "content": json.dumps(self.candidate())}
        wrote = []

        class Done:
            returncode = 0

        with mock.patch.object(uploader, "remote_manifest",
                               return_value=(landed, 9)), \
                mock.patch.object(uploader.subprocess, "run",
                                  side_effect=lambda argv, **kw: (
                                      wrote.append(argv), Done())[1]):
            result = uploader.run_scope(scope, dry_run=False)
        self.assertEqual(result["exit"], 3)
        self.assertEqual(result["error"], "overlay_base_no_longer_live")
        self.assertEqual(wrote, [], "it published anyway")

    def test_a_dropped_manifest_key_is_not_read_as_null(self):
        # ⚠️ `accepted_feedback_records_sha256` is ABSENT on v2 and NULL on
        # v3, and `.get()` returns None for both — so a candidate that had
        # dropped the key would pass a field comparison while the CLIENT
        # rejects the whole manifest for it, leaving cold readers with no
        # data at all.
        candidate = self.candidate()
        del candidate["accepted_feedback_records_sha256"]
        self.assertEqual(
            uploader.overlay_advance(PUBLICATION, candidate),
            "publication_id_already_used:accepted_feedback_records_sha256")

    def test_the_cold_refusal_still_holds_for_everything_else(self):
        # The rule this door is cut into: a second manifest for one
        # run_id that is NOT a hot release is still refused.
        candidate = {**PUBLICATION, "generated_at": "2026-08-31T09:00:00Z"}
        self.assertIsNotNone(uploader.overlay_advance(PUBLICATION, candidate))


if __name__ == "__main__":
    unittest.main()
