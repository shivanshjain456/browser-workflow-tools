#!/usr/bin/env python3
"""Independent full-RGBA check of the exact-production mouse PNG save."""
from pathlib import Path
import hashlib,json
from PIL import Image,__version__
root=Path(__file__).resolve().parent.parent
check=json.loads((root/'audit/evidence/candidate-browser-checks.json').read_text())
sha=hashlib.sha256((root/'release/save-image-as-type.user.js').read_bytes()).hexdigest()
assert check['sha256']==sha
original=root/'test/fixtures/opaque.png';output=root/'audit/evidence/candidate-saved/0.png'
assert check['save']['count']==1 and check['save']['bytes']==output.stat().st_size
first=Image.open(original).convert('RGBA');second=Image.open(output).convert('RGBA')
assert first.size==second.size and first.tobytes()==second.tobytes()
report={'decoder':'Pillow '+__version__,'candidateSha256':sha,'input':str(original.relative_to(root)),'output':str(output.relative_to(root)),'outputBytes':output.stat().st_size,'outputSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'size':first.size,'inputPixelSha256':hashlib.sha256(first.tobytes()).hexdigest(),'outputPixelSha256':hashlib.sha256(second.tobytes()).hexdigest(),'fullRgbaPixelsEqual':True}
(root/'audit/evidence/production-pixel-identity.json').write_text(json.dumps(report,indent=2)+'\n')
print('PASS: exact-production saved PNG full RGBA pixels equal input, independently decoded.')
