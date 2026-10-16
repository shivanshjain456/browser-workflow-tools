#!/usr/bin/env python3
"""Build a complete, publishable snapshot of this repository.

Everything a `git push` would include is inside; everything `.gitignore` excludes
(local caches, verification scratch, downloaded manager/browser assets, the
release source capsule) is left out. Reproducible: fixed timestamps, sorted
entries, normalised permissions.

Usage:
    python3 scripts/make-repository-zip.py [output.zip]
Default output: <parent of the checkout>/save-image-as-type-repository.zip
"""
from pathlib import Path
import hashlib, zipfile

root = Path(__file__).resolve().parent.parent
out = Path(__file__).resolve().parent.parent.parent / 'save-image-as-type-repository.zip'

# Top-level entries that belong in a published repository.
TRACKED_DIRS = ['.github', 'audit', 'docs', 'release', 'scripts', 'src', 'test', 'tools']
TRACKED_FILES = [
    '.editorconfig', '.gitignore', 'CHANGELOG.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
    'LICENSE', 'README.md', 'SECURITY.md', 'SUPPORT.md', 'build.mjs', 'lint.mjs',
    'package-lock.json', 'package.json',
]
# Never published even if present.
EXCLUDE_PARTS = {'node_modules', '__pycache__', '.cache', '.local', '.tmp-browser', '.tmp-test',
                 '.tmp-capsule', '.git', '.venv', 'dist'}
EXCLUDE_SUFFIXES = ('.pyc',)
# The installable artifact IS published; the build outputs next to it are not.
KEEP = {'release/save-image-as-type.user.js', 'release/SHA256SUMS',
        'release/release-manifest.json', 'release/PACKAGE_SHA256SUMS'}


def included(path: Path) -> bool:
    rel = path.relative_to(root)
    if any(part in EXCLUDE_PARTS for part in rel.parts):
        return False
    if rel.suffix in EXCLUDE_SUFFIXES:
        return False
    if rel.parts[0] == 'release' and str(rel) not in KEEP:
        return False
    # Release archives are rebuilt, never committed; golden fixtures are inputs
    # and must stay (they are .zip files too).
    if rel.parts[0] == 'release' and rel.suffix == '.zip':
        return False
    if rel.parts[0] == 'docs' and '_evidence' in rel.parts:
        return False
    return True


def collect() -> list[Path]:
    files: list[Path] = []
    for folder in TRACKED_DIRS:
        base = root / folder
        if not base.exists():
            continue
        for path in base.rglob('*'):
            if path.is_file() and included(path):
                files.append(path)
    for name in TRACKED_FILES:
        path = root / name
        if path.is_file() and included(path):
            files.append(path)
    return sorted(set(files))


def main() -> None:
    files = collect()
    assert any(str(f.relative_to(root)) == 'release/save-image-as-type.user.js' for f in files), \
        'the installable artifact must be in the snapshot'
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            rel = str(path.relative_to(root))
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3                     # Unix
            info.external_attr = 0o100644 << 16        # regular file, 0644
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes(), compresslevel=9)
    with zipfile.ZipFile(out) as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        for required in ['README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/installation.md',
                         'release/save-image-as-type.user.js', '.github/workflows/ci.yml',
                         'test/golden/unicode.zip', 'test/golden/manifest.json', 'docs/reference/settings.md',
                         'scripts/verify-release.mjs']:
            assert required in names, required
        leaked = [n for n in names if any(part in EXCLUDE_PARTS for part in Path(n).parts)]
        assert not leaked, leaked
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f'{out.name}: {out.stat().st_size} bytes, {len(files)} files, sha256 {digest}')


if __name__ == '__main__':
    main()
