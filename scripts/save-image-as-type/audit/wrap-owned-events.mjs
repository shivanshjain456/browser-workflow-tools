// Maintainer-only readable source transform; parser is a development dependency,
// not inlined into the installed script. Re-run only from the pre-guard snapshot.
import esprima from 'esprima';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
const files=readdirSync('src/ui').filter(x=>x.endsWith('.js')&&x!=='events.js').map(x=>'src/ui/'+x).concat('src/main.js');
let total=0;
for(const path of files){
 let source=readFileSync(path,'utf8');const tokens=esprima.tokenize(source,{range:true,tolerant:true});const edits=[];
 for(let i=1;i<tokens.length-1;i++){
  if(!['addEventListener','removeEventListener'].includes(tokens[i].value)||tokens[i-1].value!=='.'||tokens[i+1].value!=='(')continue;
  let depth=0,comma=-1,end=-1;
  for(let n=i+2;n<tokens.length;n++){
   const token=tokens[n];if(token.type!=='Punctuator')continue;
   if(depth===0&&token.value===','){if(comma<0){comma=n;continue;}end=n;break;}
   if(depth===0&&token.value===')'){end=n;break;}
   if(['(','[','{'].includes(token.value))depth++;
   if([')',']','}'].includes(token.value))depth--;
  }
  if(comma<0||end<0)throw Error('Unparsed event call '+path);
  const start=tokens[comma+1].range[0],stop=tokens[end].range[0];
  const argument=source.slice(start,stop).trimEnd();
  edits.push({start,stop,text:'guardUserEvent('+argument+')'});
 }
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.stop);
 if(edits.length){source=`import { guardUserEvent } from '${path==='src/main.js'?'./ui/events.js':'./events.js'}';\n`+source;writeFileSync(path,source);total+=edits.length;console.log(path,edits.length);}
}
console.log('wrapped callback references (including exact removal identities):',total);
