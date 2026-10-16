#!/usr/bin/env node
/** Fail-closed offline verification pipeline, NOT a release-acceptance shortcut.
 * Exit1 = failed prerequisite/test; exit2 = measured candidate gates pass but
 * full engineering/release acceptance is still explicitly blocked.
 * Requires installed dev dependencies and Python requirements; never downloads
 * or installs anything itself. Local browser probes open loopback HTTP servers.
 */
import {createHash} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const evidence=resolve(root,'audit/evidence');
mkdirSync(evidence,{recursive:true});
const artifactHash=()=>createHash('sha256').update(readFileSync(resolve(root,'release/save-image-as-type.user.js'))).digest('hex');
const initialHash=artifactHash();
const steps=[];
function run(name,args) {
  console.log(`\n=== ${name} ===`);
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
  const output=(result.stdout||'')+(result.stderr||'');
  writeFileSync(resolve(evidence,`pipeline-${name}.txt`),output);
  console.log(output);
  if(name==='unit')writeFileSync(resolve(evidence,'candidate-unit-current.txt'),output);
  steps.push({name,status:result.status,signal:result.signal,error:result.error?.message});
  if(result.error||result.status!==0) finish(1,`FAILED: ${name}`);
}
function finish(code,status) {
  writeFileSync(resolve(evidence,'pipeline-summary.json'),JSON.stringify({status,exitCode:code,artifactSha256:initialHash,steps},null,2)+'\n');
  console.log(status);
  process.exit(code);
}
run('preflight',['audit/preflight.mjs']);
run('build',['build.mjs','--check']);
run('lint',['lint.mjs']);
run('unit',['test/run-unit.mjs']);
for(let i=1;i<=2;i++) {
  run(`browser-${i}`,['test/browser/run.mjs']);
  copyFileSync(resolve(root,'.tmp-browser/report.json'),resolve(evidence,`candidate-browser-final${i===1?'':'-run2'}.json`));
}
run('production',['audit/probe-production.mjs','release/save-image-as-type.user.js','audit/evidence/candidate-production.json']);
run('production-ui',['audit/browser-checks.mjs','release/save-image-as-type.user.js','candidate']);
run('synthetic-attack',['audit/synthetic-action-probe.mjs']);
run('goldens',['audit/independent-goldens.mjs']);
run('assertions',['audit/assert-evidence.mjs']);
const manifest=JSON.parse(readFileSync(resolve(root,'release/release-manifest.json'),'utf8'));
if(manifest.sha256!==initialHash||artifactHash()!==initialHash) finish(1,'Artifact/manifest mismatch, or artifact changed during verification');
if(manifest.releaseAccepted!==true) finish(2,'CANDIDATE REGRESSION GATES PASSED; RELEASE BLOCKED. The full engineering brief is NOT completed.');
finish(0,'Recorded regression gates passed. Acceptance still depends on reviewed manager/spec/lifecycle evidence, not this command alone.');
