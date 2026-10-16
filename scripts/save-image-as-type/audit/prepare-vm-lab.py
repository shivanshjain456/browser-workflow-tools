#!/usr/bin/env python3
"""Explicit DEVELOPMENT setup, Linux x86_64 only. Downloads official test assets.
Never imported by the installed userscript. No personal browser profile touched.
Manager permission/installation still uses manager-lab-setup.mjs's native UI.
"""
from pathlib import Path,PurePosixPath
import hashlib,json,os,platform,shutil,stat,subprocess,sys,urllib.request,zipfile
root=Path(__file__).resolve().parent.parent
os.chdir(root)
assert sys.platform=='linux' and platform.machine() in ('x86_64','AMD64'),'This measured manager lab targets Linux x86_64 only'
node=shutil.which('node');assert node,'Install supported Node first'
v=subprocess.check_output([node,'-p','process.versions.node'],text=True).strip()
assert tuple(map(int,v.split('.'))) >= (22,22,2),'Node>=22.22.2 required'
lab=root/'.local/manager-lab';lab.mkdir(parents=True,exist_ok=True)
url='https://github.com/violentmonkey/violentmonkey/releases/download/v2.49.0/Violentmonkey-mv3-v2.49.0.zip'
archive=lab/'violentmonkey.zip'
if not archive.exists():
    print('Downloading official VM test asset (development setup only)',flush=True)
    with urllib.request.urlopen(url,timeout=90) as source,archive.open('wb') as out:shutil.copyfileobj(source,out)
sha=hashlib.sha256(archive.read_bytes()).hexdigest()
assert sha=='3fa676c803a9698453ed23dfe496d4bc29a4bec52f6a95e55c43c2955921f8ee','VM asset fingerprint mismatch: refuse unreviewed changed input'
ext=lab/'vm';ext.mkdir(exist_ok=True)
with zipfile.ZipFile(archive) as z:
    items=z.infolist();assert len(items)<2048 and sum(i.file_size for i in items)<32*1024*1024
    names=set()
    for item in items:
        name=PurePosixPath(item.filename)
        assert not name.is_absolute() and '..' not in name.parts and '\\' not in item.filename and item.filename not in names,'Unsafe archive path'
        assert not stat.S_ISLNK(item.external_attr>>16),'Refuse symlink archive member'
        names.add(item.filename)
    z.extractall(ext)
manifest=json.loads((ext/'manifest.json').read_text());assert manifest['version']=='2.49.0' and manifest['manifest_version']==3
chrome=lab/'browsers/chrome/linux-155.0.8059.84/chrome-linux64/chrome'
if not chrome.exists():
    cli=root/'node_modules/@puppeteer/browsers/lib/main-cli.js';assert cli.exists(),'Run npm ci first'
    subprocess.run([node,str(cli),'install','chrome@155.0.8059.84','--path',str(lab/'browsers')],check=True)
version=subprocess.check_output([str(chrome),'--version'],text=True).strip();assert '155.0.8059.84' in version
h=hashlib.sha256()
with chrome.open('rb') as f:
    for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
assert h.hexdigest()=='b866a2964538c825538c454de4867973b926650da57ec12dc3328807d768247b','Unexpected Chrome test executable fingerprint'
record={'scope':'Development-only download/setup, Linux x86_64; unchanged official VM unpacked for lab, not signed-store installation; no runtime dependency','node':v,'managerUrl':url,'managerArchiveSha256':sha,'managerVersion':manifest['version'],'chromeVersion':version,'chromeExecutableSha256':h.hexdigest(),'next':'node audit/manager-lab-setup.mjs && node audit/real-manager.mjs vm && python3 audit/verify-manager-outputs.py vm'}
(root/'audit/evidence/manager-lab').mkdir(parents=True,exist_ok=True)
(root/'audit/evidence/manager-lab/assets.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
