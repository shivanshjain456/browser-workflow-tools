// Comparative lexical metrics, not the independent auditor's undisclosed method.
import tokenizer from 'js-tokens';
import {readFileSync,writeFileSync} from 'node:fs';
const keywords=new Set('as async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof var void while with yield'.split(' '));
const output={method:'js-tokens 4.0.0 explicitly pinned development tool; unique name tokens excluding listed keywords; comments counted by character and touched lines. Template strings are single tokens, so names inside interpolations are excluded. Comparable estimates, not identical to auditor identifier taxonomy.',files:[]};
for(const path of ['audit/baseline/v2.0.0.user.js','release/save-image-as-type.user.js']){
 const source=readFileSync(path,'utf8'),names=new Set();let commentChars=0;const commentLines=new Set();
 const regex=new RegExp(tokenizer.default.source,'g');
 for(const match of source.matchAll(regex)){
  const token=tokenizer.matchToToken(match);
  if(token.type==='name'&&!keywords.has(token.value))names.add(token.value);
  if(token.type==='comment'){
   commentChars+=token.value.length;let start=source.slice(0,match.index).split('\n').length;
   for(let i=0;i<token.value.split('\n').length;i++)commentLines.add(start+i);
  }
 }
 output.files.push({path,bytes:Buffer.byteLength(source),newlines:source.split('\n').length-1,uniqueNames:names.size,shortNames:[...names].filter(x=>x.length<=2).length,shortNamePercent:100*[...names].filter(x=>x.length<=2).length/names.size,commentCharacterPercent:100*commentChars/source.length,commentLinePercent:100*commentLines.size/(source.split('\n').length-1)});
}
writeFileSync('audit/evidence/readability.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
