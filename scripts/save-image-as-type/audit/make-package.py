#!/usr/bin/env python3
"""Package one runtime plus its offline verification sources, without dependencies/caches.
Stable ordering, permissions and timestamps make this reproducible on the tested zlib.
"""
from pathlib import Path
import zipfile,hashlib
root=Path(__file__).resolve().parent.parent
name='save-image-as-type-2.0.1-candidate-source.zip'
dest=root/'release'/name
included=[]
for folder in ['src','test','tools','docs','audit','scripts','.github']:
    for path in (root/folder).rglob('*'):
        if not path.is_file() or any(part in ['__pycache__','node_modules','.cache'] for part in path.parts):continue
        included.append(path)
for namepart in ['build.mjs','lint.mjs','package.json','package-lock.json','README.md','CHANGELOG.md','LICENSE','CONTRIBUTING.md','CODE_OF_CONDUCT.md','SECURITY.md','SUPPORT.md','.editorconfig','.gitignore','release/save-image-as-type.user.js','release/release-manifest.json','release/SHA256SUMS']:
    path=root/namepart
    if path.exists():included.append(path)
with zipfile.ZipFile(dest,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for path in sorted(set(included)):
        rel=str(path.relative_to(root));info=zipfile.ZipInfo(rel,date_time=(2026,10,16,0,0,0));info.create_system=3;info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED
        archive.writestr(info,path.read_bytes(),compresslevel=9)
with zipfile.ZipFile(dest) as archive:
    assert archive.testzip() is None
    assert archive.read('release/save-image-as-type.user.js')==(root/'release/save-image-as-type.user.js').read_bytes()
checksum=hashlib.sha256(dest.read_bytes()).hexdigest()
(root/'release/PACKAGE_SHA256SUMS').write_text(checksum+'  '+dest.name+'\n')
print(f'{dest.name}: {dest.stat().st_size} bytes, {len(set(included))} files, sha256 {checksum}')
