/** Enumerate explicit files: Node22 + loader does not accept a test-directory import.
 * A real failure must propagate; never accept an empty discovery as green.
 */
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=readdirSync(resolve(root,'test/unit')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'test/unit/'+name);
if(!files.length)throw Error('No unit test files discovered');
const result=spawnSync(process.execPath,['--import','./test/helpers/register-event-policy.mjs','--test',...process.argv.slice(2),...files],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
