#!/usr/bin/env python3
"""Replace only the Azure Ubuntu archive URI; retain repositories and signing."""
import pathlib
import re
import sys
from urllib.parse import urlsplit

APT_LIMITS = 'Acquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nAcquire::Retries "1";\n'


def replace_uri(uri):
    parsed = urlsplit(uri)
    if parsed.hostname != "azure.archive.ubuntu.com":
        return uri
    if parsed.scheme not in ("http", "https") or parsed.netloc != "azure.archive.ubuntu.com" or parsed.path not in ("/ubuntu", "/ubuntu/") or parsed.query or parsed.fragment:
        raise ValueError("Unrecognized Azure archive URI; no sources changed")
    return "https://archive.ubuntu.com" + parsed.path


def transform(text, deb822):
    output = []
    uri_field = False
    for line in text.splitlines(keepends=True):
        if not line.strip() or line.lstrip().startswith("#"):
            if not line.strip():
                uri_field = False
            output.append(line)
            continue
        if deb822:
            field = re.match(r"^(URIs:\s*)(.*)", line, re.IGNORECASE)
            if field:
                uri_field = True
                prefix = field[1]
                body = line[len(prefix):]
            elif line[0].isspace() and uri_field:
                prefix, body = "", line
            else:
                uri_field = False
                output.append(line)
                continue
            output.append(prefix + re.sub(r"\S+", lambda m: replace_uri(m[0]), body))
        else:
            entry = re.match(r"^(deb(?:-src)?\s+(?:\[[^\]]*\]\s+)?)(\S+)(?=\s)", line)
            if entry:
                line = line[:entry.start(2)] + replace_uri(entry[2]) + line[entry.end(2):]
            output.append(line)
    return "".join(output)


def prepare(root):
    root = pathlib.Path(root)
    parts = root / "sources.list.d"
    config = root / "apt.conf.d"
    if root.is_symlink() or parts.is_symlink() or config.is_symlink() or not config.is_dir():
        raise ValueError("Unrecognized APT directory")
    sources = [root / "sources.list", *sorted(parts.glob("*.list")), *sorted(parts.glob("*.sources"))]
    changes = []
    for source in sources:
        if source.is_symlink():
            raise ValueError("Symlink APT source; no sources changed")
        if source.exists():
            before = source.read_text()
            after = transform(before, source.suffix == ".sources")
            if before != after:
                changes.append((source, after))
    limits = config / "99-lua-e2e-network-limits"
    if limits.is_symlink() or (limits.exists() and limits.read_text() != APT_LIMITS):
        raise ValueError("Existing unrelated limits configuration")
    # Validate every file before writing: ambiguous sources fail closed.
    for source, after in changes:
        source.write_text(after)
    limits.write_text(APT_LIMITS)
    limits.chmod(0o644)
    print(f"Ubuntu archive prepared: {len(changes)} source file(s); signing settings preserved")


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("This CI helper uses only /etc/apt")
    prepare("/etc/apt")
