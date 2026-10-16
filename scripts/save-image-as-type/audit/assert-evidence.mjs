// Candidate safety/regression assertions. Passing does NOT accept the entire brief.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha256=createHash('sha256').update(readFileSync('release/save-image-as-type.user.js')).digest('hex');
const manifest=JSON.parse(readFileSync('release/release-manifest.json'));
assert.equal(manifest.sha256,sha256,'manifest must identify current source');
assert.equal(manifest.defaultSettingsKeys,49,'48 original defaults plus the profiles list');
const unit=readFileSync('audit/evidence/candidate-unit-current.txt','utf8');
for(const key of ['tests','pass'])assert.equal(Number(unit.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]),manifest.gates.unit.total,'full unit count');
for(const key of ['fail','skipped','cancelled','todo'])assert.match(unit,new RegExp('^# '+key+' 0$','m'));
const production=JSON.parse(readFileSync('audit/evidence/candidate-production.json'));
assert.equal(production.sha256,sha256,'production evidence source drift');
for(const entry of production.cases){
 assert.equal(entry.commands,8,entry.kind+' must boot');assert.equal(entry.publicHandle,false,entry.kind+' must not publish capability');assert.equal(entry.privilegedWrite,false);assert.deepEqual(entry.errors,[]);assert.deepEqual(entry.pageStorageCalls,[]);assert.equal(entry.cookie,'');
 const external=entry.requests.filter(x=>x.type!=='document'&&!x.url.endsWith('/favicon.ico'));assert.deepEqual(external,[],'no script requests at boot');
}
assert.equal(production.frames.frames.length,11);
assert.deepEqual(production.frames.frames.map(x=>x.commands),[8,...Array(10).fill(0)],'frame commands belong to the top document only');
const checks=JSON.parse(readFileSync('audit/evidence/candidate-browser-checks.json'));
assert.equal(checks.sha256,sha256,'production UI evidence source drift');
assert.equal(checks.save.count,1,'one real menu action saves once');
assert.equal(checks.keyboardSave.newDownloads,1,'one real menu digit saves once');
assert.deepEqual(checks.keyboardSaves.map(x=>[x.key,x.newDownloads]),[['1',1],['Enter',1],['Space',1]],'real digit, Enter and Space each save exactly once');
const synthetic=JSON.parse(readFileSync('audit/evidence/synthetic-action-after.json'));
assert.equal(synthetic.sha256,sha256,'attack evidence source drift');
assert.equal(synthetic.menuOpened,false,'synthetic context menu rejected');
assert.equal(synthetic.privilegedFetchAttempted,false,'synthetic UI must not trigger manager request');
for(const entry of checks.boot){assert.equal(entry.commands,8);assert.deepEqual(entry.localStorageKeys,[]);assert.deepEqual(entry.sessionStorageKeys,[]);assert.equal(entry.cookie,'');assert.deepEqual(entry.errors,[]);assert.equal(entry.publicHandle,false);}
const mode=name=>checks.a11y.find(x=>x.mode===name);
assert.ok(mode('default').minTextPx>=12);
assert.ok(mode('large-type').minTextPx>=2*mode('default').minTextPx);
assert.equal(mode('reduced-motion').reducedMotion,true);assert.equal(mode('reduced-motion').motionAnimation,'none');assert.equal(mode('reduced-motion').motionTransition,'0s');
assert.equal(mode('forced-colors').forcedColors,true);assert.match(mode('forced-colors').focusOutline,/3px/);
assert.equal(mode('more-contrast').moreContrast,true);
const workflow=checks.profileWorkflow;
assert.ok(workflow,'profile workflow evidence missing');
assert.equal(workflow.capturedThroughRealUI,true,'a profile is captured through the real dialog');
assert.equal(workflow.appliedThroughRealUI,true,'applying a profile restores the configuration through the real buttons');
assert.ok(workflow.sameDocumentStoreWritesContainingProfile>=1,'the profile is written through manager storage');
assert.equal(workflow.fakeStoreResetsOnReload,true,'the harness store reset must be reported, not hidden');
const manager=JSON.parse(readFileSync('audit/evidence/manager-lab/vm-production.json'));
const managerProfile=manager.profileWorkflow;
assert.ok(managerProfile&&managerProfile.persistedAfterPageReload&&managerProfile.appliedThroughRealUI&&managerProfile.deletedAndRestored,'actual-manager profile round trip (capture, reload, apply, delete) must be recorded');
assert.equal(manager.artifactSha256,sha256,'actual-manager evidence must match the current artifact');
const report=JSON.parse(readFileSync('audit/evidence/candidate-browser-final.json'));
assert.equal(report.results.filter(x=>x.status==='pass').length,57);assert.equal(report.results.filter(x=>x.status!=='pass').length,0);
console.log('PASS: candidate attacks, production single-save, UI preferences, instrumented fixture regression.');
console.log('RELEASE BLOCKED: separate execution duplicates command registration; remaining S1 work and real-manager matrix are incomplete. Passing these assertions is NOT Definition of Done.');
