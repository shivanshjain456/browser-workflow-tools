#!/usr/bin/env python3
"""Independently verify actual-manager download snapshots, not a GM shim."""
from pathlib import Path
import hashlib,json,sys,xml.etree.ElementTree as ET
import PIL
from PIL import Image
root=Path(__file__).resolve().parent.parent
manager=sys.argv[1] if len(sys.argv)>1 else 'vm'
assert manager in ('vm','tm'),'Expected vm or tm'
folder=root/'audit/evidence/manager-lab'
report=json.loads((folder/f'{manager}-production.json').read_text())
assert report.get('completed') is True, 'Manager run did not complete; do not count it as compatibility'
assert report['artifactSha256']==hashlib.sha256((root/'release/save-image-as-type.user.js').read_bytes()).hexdigest()
assert any(x['sha256']==report['artifactSha256'] for x in report['storedCodeHashes'])
original=(root/'test/fixtures/opaque.png').read_bytes()
pixels=Image.open(root/'test/fixtures/opaque.png').convert('RGBA')
assert {x['path'] for x in report['tests']} >= {'/same','/cross','/csp','/data-csp','/svg-csp'},'Full canonical matrix required'
assert len(report.get('embeddedConversions',[]))==2,'Both embedded-document scenarios required'
outputs=[]
for case in report['tests']:
    assert case['synthetic']['isTrusted'] is False and case['synthetic']['visible'] is False
    assert case['syntheticRequests']==[]
    assert len(case['original']['downloads'])==1
    # SVG raster fallback is explicitly unsupported here; original still works.
    assert len(case['downloads'])==(0 if case['path']=='/svg-csp' else 1)
    for item in case['downloads']:outputs.append((case['path'],'converted',item))
    for item in case['original']['downloads']:outputs.append((case['path'],'original',item))
for frame in report.get('embeddedConversions',[]):
    assert len(frame['files'])==1
    for item in frame['files']:outputs.append(('embedded','converted',item))
assert report['settingsPersistence']=={'prefixAfterReload':'lab-owned-storage','restoredPrefix':''}
if manager=='vm':assert report['frameMenuEntries']==8
profile=report.get('profileWorkflow')
assert profile and profile['capturedThroughRealUI'] and profile['persistedAfterPageReload'] and profile['appliedThroughRealUI'] and profile['deletedAndRestored'],'Real-manager profile workflow incomplete'
assert profile['afterApply']['direction'] in ('ltr','rtl')
checks=[]
for case,kind,out in outputs:
    path=(root/out['file']).resolve();assert path.is_relative_to(folder.resolve()) and path.name.startswith(manager+'-')
    data=path.read_bytes()
    sha=hashlib.sha256(data).hexdigest();assert sha==out['sha256']
    check={'case':case,'kind':kind,'file':out['file'],'sha256':sha,'bytes':len(data)}
    if path.suffix=='.svg':
        svg=ET.fromstring(data);assert svg.tag=='{http://www.w3.org/2000/svg}svg'
        assert svg.attrib['width']=='160' and svg.attrib['height']=='120'
        rect=list(svg);assert len(rect)==1 and rect[0].tag=='{http://www.w3.org/2000/svg}rect' and rect[0].attrib=={'width':'160','height':'120','fill':'red'}
        check['svgRoot']=svg.tag;check['svgFixtureStructureEqual']=True
    else:
        image=Image.open(path).convert('RGBA')
        assert image.size==pixels.size and image.tobytes()==pixels.tobytes()
        check['rgbaEqual']=True;check['pixelSha256']=hashlib.sha256(image.tobytes()).hexdigest()
        if kind=='original':assert data==original;check['originalBytesEqual']=True
    checks.append(check)
(folder/f'{manager}-independent-output-checks.json').write_text(json.dumps({'Pillow':PIL.__version__,'artifactSha256':report['artifactSha256'],'checks':checks},indent=2)+'\n')
print(f'{len(checks)} independent output checks passed; original raster bytes exact; owned settings restored; SVG raster limitation retained.')
