#!/usr/bin/env python3
"""Create/reverse three recent isolated source+regression-test groups in clones.
No production files are reverted. Removed feature tests travel with that group;
remaining unit contracts and original byte goldens must still pass. This does
NOT prove that earlier hardening groups are independently releasable commits.
"""
from pathlib import Path
import difflib,hashlib,json,os,re,shutil,subprocess
root=Path(__file__).resolve().parent.parent
os.chdir(root)
node=shutil.which('node')
assert int(subprocess.check_output([node,'-p','process.versions.node.split(".")[0]'],text=True))>=22

def without_test(text,name):
    start=text.index("  test('"+name+"'")
    end=text.index('\n  });',start)+len('\n  });')
    return text[:start]+text[end:]
def old_menu_tests():
    text=(root/'test/unit/ui-menu.test.mjs').read_text()
    for name in ['detaching during a pending long press cancels timer and local subscriptions','completed long press releases local handlers even without pointerup','replacement touch sessions retain only one set of transient listeners']:
        text=without_test(text,name)
    return text
frame_test='embedded document keeps interaction without registering another eight manager commands'
groups={
 'acquisition-contract':{
  'src/core/raster.js':(root/'audit/checkpoints/before-acquisition/raster.js').read_text(),
  'src/core/source.js':(root/'audit/checkpoints/before-acquisition/source.js').read_text(),
  'test/unit/core-acquisition.test.mjs':'',
 },
 'long-press-lifetime':{
  'src/ui/menu.js':(root/'audit/checkpoints/before-ui-lifetime/menu.js').read_text(),
  'test/unit/ui-menu.test.mjs':old_menu_tests(),
 },
 'top-frame-commands':{
  'src/main.js':(root/'audit/checkpoints/before-ui-lifetime/main.js').read_text(),
  'src/entry.js':(root/'src/entry.js').read_text().replace(' * Frame policy: document-local interaction including subframes; eight manager\n * commands in the top frame only. This is not cross-manager arbitration.\n',''),
  'test/unit/main-bootstrap.test.mjs':without_test((root/'test/unit/main-bootstrap.test.mjs').read_text(),frame_test),
 },
}
expected={'acquisition-contract':569,'long-press-lifetime':574,'top-frame-commands':576}
results=[]
for group,files in groups.items():
    patch=''
    for file,old in files.items():
        patch+=''.join(difflib.unified_diff(old.splitlines(keepends=True),(root/file).read_text().splitlines(keepends=True),fromfile='a/'+file if old else '/dev/null',tofile='b/'+file))
    patchfile=root/'audit/patches'/('group-'+group+'.patch');patchfile.write_text(patch)
    clone=root/'.local/reversion-check'/group
    shutil.rmtree(clone,ignore_errors=True);clone.mkdir(parents=True)
    for folder in ['src','test','tools','audit']:
        shutil.copytree(root/folder,clone/folder,ignore=shutil.ignore_patterns('__pycache__'))
    for file in ['package.json','build.mjs','lint.mjs']:shutil.copy(root/file,clone/file)
    log=[]
    def run(args):
        result=subprocess.run(args,cwd=clone,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        log.append('$ '+' '.join(args)+'\n'+result.stdout)
        (root/'audit/evidence'/('rollback-'+group+'.txt')).write_text('\n'.join(log))
        assert result.returncode==0,(group,args,result.stdout[-2500:])
        return result.stdout
    run(['patch','--reverse','--strip=1','--input',str(patchfile)])
    for file,old in files.items():
        if old:assert (clone/file).read_text()==old
        else:assert not (clone/file).exists()
    run([node,'build.mjs'])
    run([node,'build.mjs','--check'])
    run([node,'lint.mjs'])
    units=run([node,'test/run-unit.mjs'])
    count=int(re.search(r'^# tests (\d+)$',units,re.M)[1]);assert count==expected[group]
    for key in ['fail','skipped','cancelled','todo']:assert re.search('^# '+key+' 0$',units,re.M)
    record={'group':group,'patch':str(patchfile.relative_to(root)),'remainingTestsPassed':count,'lint':27,'build':True,'reversedFiles':list(files),'scope':'Rollback source and its own tests only; all other groups retained; unit corpus includes original pinned byte goldens; no claim the removed feature still works'}
    results.append(record);print(group,count,'PASS',flush=True)
report={'sourceSha256':hashlib.sha256((root/'release/save-image-as-type.user.js').read_bytes()).hexdigest(),'node':subprocess.check_output([node,'--version'],text=True).strip(),'groups':results,'earlierHardeningGroups':'not certified by this tool'}
(root/'audit/evidence/independent-rollbacks.json').write_text(json.dumps(report,indent=2)+'\n')
