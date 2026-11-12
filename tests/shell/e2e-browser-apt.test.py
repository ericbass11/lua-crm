#!/usr/bin/env python3
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("prepare", pathlib.Path(__file__).resolve().parents[2] / "scripts/prepare-e2e-apt.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class AptPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        (self.root / "sources.list.d").mkdir()
        (self.root / "apt.conf.d").mkdir()

    def test_list_retains_signing_components_and_comments(self):
        text = "# http://azure.archive.ubuntu.com/ubuntu\ndeb [signed-by=/key.gpg] http://azure.archive.ubuntu.com/ubuntu noble main universe\n"
        expected = "# http://azure.archive.ubuntu.com/ubuntu\ndeb [signed-by=/key.gpg] https://archive.ubuntu.com/ubuntu noble main universe\n"
        self.assertEqual(prepare.transform(text, False), expected)

    def test_deb822_multiple_uris_and_continuations_preserve_signed_by(self):
        text = "Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/ https://third.example/repo\n https://azure.archive.ubuntu.com/ubuntu\nSuites: noble-updates\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
        expected = text.replace("http://azure.archive.ubuntu.com", "https://archive.ubuntu.com").replace("https://azure.archive.ubuntu.com", "https://archive.ubuntu.com")
        self.assertEqual(prepare.transform(text, True), expected)

    def test_unrelated_repository_and_similar_hostname_unchanged(self):
        text = "deb https://azure.archive.ubuntu.com.attacker.test/ubuntu noble main\ndeb https://security.ubuntu.com/ubuntu noble-security main\n"
        self.assertEqual(prepare.transform(text, False), text)

    def test_ambiguous_uri_fails_before_any_write(self):
        good = self.root / "sources.list"
        good.write_text("deb http://azure.archive.ubuntu.com/ubuntu noble main\n")
        bad = self.root / "sources.list.d/z.sources"
        bad.write_text("URIs: http://azure.archive.ubuntu.com/unknown\n")
        with self.assertRaises(ValueError):
            prepare.prepare(self.root)
        self.assertIn("azure.archive", good.read_text())
        self.assertFalse((self.root / "apt.conf.d/99-lua-e2e-network-limits").exists())

    def test_symlink_fails_closed(self):
        target = self.root / "external"
        target.write_text("deb http://azure.archive.ubuntu.com/ubuntu noble main\n")
        (self.root / "sources.list").symlink_to(target)
        with self.assertRaises(ValueError):
            prepare.prepare(self.root)
        self.assertIn("azure.archive", target.read_text())

    def test_limits_and_idempotence(self):
        source = self.root / "sources.list"
        source.write_text("deb http://azure.archive.ubuntu.com/ubuntu noble main\n")
        prepare.prepare(self.root)
        prepare.prepare(self.root)
        self.assertEqual(source.read_text(), "deb https://archive.ubuntu.com/ubuntu noble main\n")
        self.assertEqual((self.root / "apt.conf.d/99-lua-e2e-network-limits").read_text(), prepare.APT_LIMITS)

    def test_existing_unrelated_limits_preserved(self):
        limits = self.root / "apt.conf.d/99-lua-e2e-network-limits"
        limits.write_text("Unrelated value;\n")
        with self.assertRaises(ValueError):
            prepare.prepare(self.root)
        self.assertEqual(limits.read_text(), "Unrelated value;\n")

    def test_runner_mirror_source_rewrites_indirection_and_preserves_metadata(self):
        source = self.root / "sources.list.d/ubuntu.sources"
        source_text = "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
        source.write_text(source_text)
        mirror = self.root / "apt-mirrors.txt"
        mirror.write_text("# runner mirrors\nhttp://azure.archive.ubuntu.com/ubuntu/\tpriority:1 arch:amd64\nhttps://third.example/repo\tpriority:9\n")
        prepare.prepare(self.root)
        self.assertEqual(source.read_text(), source_text)
        self.assertEqual(mirror.read_text(), "# runner mirrors\nhttps://archive.ubuntu.com/ubuntu/\tpriority:1 arch:amd64\nhttps://third.example/repo\tpriority:9\n")
        prepare.prepare(self.root)

    def test_security_mirrorlist_and_other_repositories_are_preserved(self):
        (self.root / "sources.list").write_text("deb mirror+file:/etc/apt/apt-mirrors-security.txt noble-security main\n")
        mirror = self.root / "apt-mirrors-security.txt"
        text = "http://azure.archive.ubuntu.com/ubuntu\tpriority:1\nhttps://security.ubuntu.com/ubuntu\tpriority:2\n"
        mirror.write_text(text)
        prepare.prepare(self.root)
        self.assertEqual(mirror.read_text(), text.replace("http://azure.archive.ubuntu.com", "https://archive.ubuntu.com"))

    def test_unreferenced_or_unknown_mirrorlist_is_not_touched(self):
        (self.root / "sources.list").write_text("deb mirror+file:/external/unrelated.txt noble main\n")
        mirror = self.root / "apt-mirrors.txt"
        text = "http://azure.archive.ubuntu.com/ubuntu\n"
        mirror.write_text(text)
        prepare.prepare(self.root)
        self.assertEqual(mirror.read_text(), text)

    def test_unsafe_mirrorlist_fails_before_source_and_limits_writes(self):
        source = self.root / "sources.list"
        text = "deb http://azure.archive.ubuntu.com/ubuntu noble main\ndeb mirror+file:/etc/apt/apt-mirrors.txt noble main\n"
        source.write_text(text)
        target = self.root / "external"
        target.write_text("http://azure.archive.ubuntu.com/ubuntu\n")
        (self.root / "apt-mirrors.txt").symlink_to(target)
        with self.assertRaises(ValueError):
            prepare.prepare(self.root)
        self.assertEqual(source.read_text(), text)
        self.assertFalse((self.root / "apt.conf.d/99-lua-e2e-network-limits").exists())

    def test_bad_uri_in_later_mirrorlist_prevents_all_writes(self):
        (self.root / "sources.list").write_text("deb mirror+file:/etc/apt/apt-mirrors.txt noble main\ndeb mirror+file:/etc/apt/apt-mirrors-security.txt noble-security main\n")
        mirror = self.root / "apt-mirrors.txt"
        text = "http://azure.archive.ubuntu.com/ubuntu\n"
        mirror.write_text(text)
        (self.root / "apt-mirrors-security.txt").write_text("http://azure.archive.ubuntu.com/unexpected\n")
        with self.assertRaises(ValueError):
            prepare.prepare(self.root)
        self.assertEqual(mirror.read_text(), text)
        self.assertFalse((self.root / "apt.conf.d/99-lua-e2e-network-limits").exists())

    def test_ambiguous_mirrorlist_reference_and_missing_file_fail(self):
        for uri in ("mirror+file:/etc/apt/apt-mirrors.txt?unexpected", "mirror+file:/etc/apt/apt-mirrors.txt"):
            (self.root / "sources.list").write_text(f"deb {uri} noble main\n")
            with self.assertRaises(ValueError):
                prepare.prepare(self.root)
            self.assertFalse((self.root / "apt.conf.d/99-lua-e2e-network-limits").exists())


if __name__ == "__main__":
    unittest.main()
