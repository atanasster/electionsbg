#!/usr/bin/env python3
"""The macOS LaunchAgent installer, and its mutual exclusion with cron.

Run:  python3 news/scripts/test_install_launchd.py

`launchctl`, `crontab` and `uname` are stubbed on PATH, so nothing here
touches the real user's launchd domain or crontab and the Darwin guard passes
on any CI host. On macOS the REAL `plutil -lint` validates the plist; elsewhere
it is stubbed, and the plist is parsed with plistlib either way.
"""

import os
import plistlib
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

NEWS = Path(__file__).resolve().parent.parent
LABEL = "com.naiasno.news-hourly"
CHECK_LABEL = "com.naiasno.news-staleness"
ENV_NAMES = ("api", "model", "upload", "pipeline", "evals")


def _plists(stdout: str) -> list:
    """--print emits the hourly agent, then the staleness agent."""
    docs = ["<?xml" + part for part in stdout.split("<?xml") if part.strip()]
    return [plistlib.loads(doc.encode("utf-8")) for doc in docs]


def _stub(bin_dir: Path, name: str, body: str) -> None:
    path = bin_dir / name
    path.write_text("#!/bin/bash\n" + body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class InstallLaunchd(unittest.TestCase):
    def setUp(self):
        self.td = Path(tempfile.mkdtemp(prefix="launchd_"))
        self.news = self.td / "news"
        (self.news / "standalone").mkdir(parents=True)
        for rel in ("install_launchd.sh", "install_cron.sh", "run_hourly.sh"):
            shutil.copy2(NEWS / rel, self.news / rel)
        for rel in ("standalone/install_launchd.sh",):
            shutil.copy2(NEWS / rel, self.news / rel)
        for name in ENV_NAMES:
            (self.news / f".env.{name}").write_text("X=1\n", encoding="utf-8")
        (self.news / "scripts").mkdir()
        (self.news / "scripts/check_staleness.py").write_text("", encoding="utf-8")
        self.agents = self.td / "LaunchAgents"
        self.bin = self.td / "bin"
        self.bin.mkdir()
        self.calls = self.td / "calls.log"
        self.crontab = self.td / "crontab.txt"
        self.crontab.write_text("", encoding="utf-8")
        self.set_launchctl("")
        self.set_uname("Darwin")
        _stub(self.bin, "crontab",
              f'if [ "$1" = "-l" ]; then cat "{self.crontab}"; '
              f'else cp "$1" "{self.crontab}"; fi\n')
        # plutil exists only on macOS; stub it so the test is portable.
        if shutil.which("plutil") is None:
            _stub(self.bin, "plutil", "exit 0\n")
        self.env = {**os.environ,
                    "PATH": f"{self.bin}:{os.environ.get('PATH', '')}",
                    "HOME": str(self.td),
                    "NEWS_LAUNCHD_AGENT_DIR": str(self.agents)}

    def set_launchctl(self, extra: str) -> None:
        # `print` answers "not loaded" so unload() never waits.
        _stub(self.bin, "launchctl",
              f'echo "launchctl $*" >> "{self.calls}"\n'
              f'[ "$1" = print ] && exit 113\n{extra}exit 0\n')

    def set_uname(self, name: str) -> None:
        _stub(self.bin, "uname", f'echo {name}\n')

    def tearDown(self):
        shutil.rmtree(self.td, ignore_errors=True)

    def run_sh(self, script: str, *args: str):
        return subprocess.run(["bash", str(self.news / script), *args],
                              cwd=self.news, env=self.env, text=True,
                              capture_output=True)

    def test_print_renders_an_hourly_agent_for_this_folder(self):
        out = self.run_sh("install_launchd.sh", "--print")
        self.assertEqual(out.returncode, 0, out.stderr)
        plist, check = _plists(out.stdout)
        self.assertEqual(plist["Label"], LABEL)
        self.assertEqual(check["Label"], CHECK_LABEL)
        self.assertEqual(check["ProgramArguments"][2:],
                         [str(self.news / "scripts/check_staleness.py"),
                          "--root", str(self.news), "--notify"])
        self.assertEqual(check["StartInterval"], 1800)
        self.assertTrue(check["RunAtLoad"])
        self.assertEqual(plist["ProgramArguments"],
                         ["/bin/bash", str(self.news / "run_hourly.sh")])
        self.assertEqual(plist["StartCalendarInterval"], {"Minute": 0})
        self.assertEqual(plist["StandardOutPath"],
                         str(self.news / "var/cron.log"))
        self.assertEqual(plist["WorkingDirectory"], str(self.news))
        self.assertFalse(self.agents.exists(), "--print must not mutate")
        self.assertFalse(self.calls.exists(), "--print must not call launchctl")

    def test_install_writes_plist_and_bootstraps(self):
        out = self.run_sh("install_launchd.sh")
        self.assertEqual(out.returncode, 0, out.stderr)
        plist_path = self.agents / f"{LABEL}.plist"
        check_path = self.agents / f"{CHECK_LABEL}.plist"
        self.assertTrue(plist_path.is_file())
        plistlib.loads(plist_path.read_bytes())
        plistlib.loads(check_path.read_bytes())
        calls = self.calls.read_text(encoding="utf-8")
        self.assertIn(f"bootstrap gui/{os.getuid()} {plist_path}", calls)
        self.assertIn(f"bootstrap gui/{os.getuid()} {check_path}", calls)
        self.assertTrue((self.news / "var").is_dir())

        again = self.run_sh("install_launchd.sh")
        self.assertEqual(again.returncode, 0, again.stderr)

        gone = self.run_sh("install_launchd.sh", "--uninstall")
        self.assertEqual(gone.returncode, 0, gone.stderr)
        self.assertFalse(plist_path.exists())
        self.assertFalse(check_path.exists())
        self.assertIn(f"bootout gui/{os.getuid()}/{CHECK_LABEL}",
                      self.calls.read_text(encoding="utf-8"))
        self.assertIn(f"bootout gui/{os.getuid()}/{LABEL}",
                      self.calls.read_text(encoding="utf-8"))

    def test_refuses_while_the_cron_block_is_installed(self):
        self.crontab.write_text("# BEGIN naiasno-news-hourly\n0 * * * * x\n"
                                "# END naiasno-news-hourly\n", encoding="utf-8")
        out = self.run_sh("install_launchd.sh")
        self.assertEqual(out.returncode, 2)
        self.assertIn("one scheduler only", out.stderr)
        self.assertFalse((self.agents / f"{LABEL}.plist").exists())

    def test_cron_installer_refuses_while_the_agent_is_installed(self):
        self.assertEqual(self.run_sh("install_launchd.sh").returncode, 0)
        out = self.run_sh("install_cron.sh")
        self.assertEqual(out.returncode, 2)
        self.assertIn("one scheduler only", out.stderr)
        self.assertEqual(self.crontab.read_text(encoding="utf-8"), "")

    def test_refuses_placeholders_and_missing_env(self):
        (self.news / ".env.api").write_text("KEY=REPLACE_ME\n", encoding="utf-8")
        out = self.run_sh("install_launchd.sh")
        self.assertEqual(out.returncode, 2)
        self.assertIn("REPLACE_ME", out.stderr)
        (self.news / ".env.api").unlink()
        out = self.run_sh("install_launchd.sh", "--print")
        self.assertEqual(out.returncode, 2)
        self.assertIn(".env.api", out.stderr)

    def make_bundle(self, name: str = "bundle") -> Path:
        bundle = self.td / name
        bundle.mkdir()
        shutil.copy2(NEWS / "standalone/install_launchd.sh",
                     bundle / "install_launchd.sh")
        shutil.copy2(NEWS / "standalone/install_cron.sh",
                     bundle / "install_cron.sh")
        (bundle / "run_hourly.sh").write_text("", encoding="utf-8")
        (bundle / "config.env").write_text("X=1\n", encoding="utf-8")
        (bundle / "news/scripts").mkdir(parents=True)
        (bundle / "news/scripts/check_staleness.py").write_text(
            "", encoding="utf-8")
        return bundle

    def run_in(self, root: Path, script: str, *args: str):
        return subprocess.run(["bash", str(root / script), *args], cwd=root,
                              env=self.env, text=True, capture_output=True)

    def test_bundle_layout_uses_config_env(self):
        bundle = self.make_bundle()
        out = self.run_in(bundle, "install_launchd.sh", "--print")
        self.assertEqual(out.returncode, 0, out.stderr)
        plist, check = _plists(out.stdout)
        self.assertEqual(plist["ProgramArguments"][1],
                         str(bundle / "run_hourly.sh"))
        self.assertEqual(check["ProgramArguments"][2],
                         str(bundle / "news/scripts/check_staleness.py"))
        (bundle / "config.env").write_text("K=REPLACE_ME\n", encoding="utf-8")
        out = self.run_in(bundle, "install_launchd.sh")
        self.assertEqual(out.returncode, 2)
        self.assertIn("REPLACE_ME", out.stderr)

    def test_bundle_cron_refuses_while_agent_installed(self):
        bundle = self.make_bundle()
        self.assertEqual(self.run_in(bundle, "install_launchd.sh").returncode, 0)
        out = self.run_in(bundle, "install_cron.sh")
        self.assertEqual(out.returncode, 2)
        self.assertIn("one scheduler only", out.stderr)
        self.assertEqual(self.crontab.read_text(encoding="utf-8"), "")

    def test_a_stray_environment_root_is_ignored(self):
        bundle = self.make_bundle()
        env = {**self.env, "NEWS_LAUNCHD_ROOT": str(self.news)}
        out = subprocess.run(["bash", str(bundle / "install_launchd.sh"),
                              "--print"], cwd=bundle, env=env, text=True,
                             capture_output=True)
        plist = _plists(out.stdout)[0]
        self.assertEqual(plist["WorkingDirectory"], str(bundle))

    def test_bootstrap_is_retried_after_a_transient_failure(self):
        flag = self.td / "failed-once"
        self.set_launchctl(f'if [ "$1" = bootstrap ] && [ ! -f "{flag}" ]; then '
                           f'touch "{flag}"; exit 5; fi\n')
        out = self.run_sh("install_launchd.sh")
        self.assertEqual(out.returncode, 0, out.stderr)
        # hourly: fail + retry; staleness: one clean bootstrap.
        self.assertEqual(self.calls.read_text(encoding="utf-8")
                         .count("launchctl bootstrap"), 3)

    def test_bootstrap_that_never_succeeds_exits_nonzero(self):
        self.set_launchctl('[ "$1" = bootstrap ] && exit 5\n')
        out = self.run_sh("install_launchd.sh")
        self.assertEqual(out.returncode, 1)
        self.assertIn("bootstrap failed", out.stderr)

    def test_reinstall_rewrites_the_same_plist(self):
        self.assertEqual(self.run_sh("install_launchd.sh").returncode, 0)
        first = (self.agents / f"{LABEL}.plist").read_bytes()
        self.assertEqual(self.run_sh("install_launchd.sh").returncode, 0)
        self.assertEqual((self.agents / f"{LABEL}.plist").read_bytes(), first)

    def test_uninstall_works_when_nothing_is_installed_or_folder_is_gone(self):
        (self.news / "run_hourly.sh").unlink()
        for name in ENV_NAMES:
            (self.news / f".env.{name}").unlink()
        out = self.run_sh("install_launchd.sh", "--uninstall")
        self.assertEqual(out.returncode, 0, out.stderr)

    def test_uninstall_is_allowed_while_a_cron_block_exists(self):
        self.crontab.write_text("# BEGIN naiasno-news-hourly\n",
                                encoding="utf-8")
        self.assertEqual(
            self.run_sh("install_launchd.sh", "--uninstall").returncode, 0)

    def test_refuses_non_darwin_but_still_prints(self):
        self.set_uname("Linux")
        out = self.run_sh("install_launchd.sh")
        self.assertEqual(out.returncode, 2)
        self.assertIn("macOS-only", out.stderr)
        self.assertEqual(
            self.run_sh("install_launchd.sh", "--print").returncode, 0)

    def test_a_zero_or_non_numeric_check_interval_is_refused(self):
        for bad in ("0", "00", "30m"):
            with self.subTest(bad=bad):
                env = {**self.env, "NEWS_STALENESS_INTERVAL_S": bad}
                out = subprocess.run(
                    ["bash", str(self.news / "install_launchd.sh"), "--print"],
                    cwd=self.news, env=env, text=True, capture_output=True)
                self.assertEqual(out.returncode, 2)
                self.assertIn("positive integer", out.stderr)

    def test_missing_checker_script_is_refused(self):
        (self.news / "scripts/check_staleness.py").unlink()
        out = self.run_sh("install_launchd.sh", "--print")
        self.assertEqual(out.returncode, 2)
        self.assertIn("check_staleness.py", out.stderr)

    def test_refuses_xml_special_characters_in_the_path(self):
        bundle = self.make_bundle("news&x")
        out = self.run_in(bundle, "install_launchd.sh", "--print")
        self.assertEqual(out.returncode, 2)
        self.assertIn("may not contain", out.stderr)

    def test_label_and_markers_agree_across_the_three_installers(self):
        # Three separately-copied scripts restate the label / plist name and
        # the cron marker; a rename in one must fail here, not in production.
        for rel in ("standalone/install_launchd.sh", "install_cron.sh",
                    "standalone/install_cron.sh"):
            text = (NEWS / rel).read_text(encoding="utf-8")
            self.assertIn(LABEL, text, rel)
            self.assertIn("# BEGIN naiasno-news-hourly", text, rel)
            self.assertIn("one scheduler only", text, rel)


if __name__ == "__main__":
    unittest.main()
