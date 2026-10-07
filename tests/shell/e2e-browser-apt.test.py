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


if __name__ == "__main__":
    unittest.main()
