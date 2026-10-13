import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const env=Object.fromEntries((await readFile('/etc/perler-cloud/workbench.env','utf8')).split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const api=(process.argv[3]??'http://127.0.0.1:18040')+'/api/v1',marker='/var/lib/perler-cloud/workbench/verification/persistence.json';
async function call(path,method='GET',body){const response=await fetch(api+path,{method,headers:{Authorization:'Bearer '+env.API_TOKEN,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});assert(response.ok,`${method} ${path}: ${response.status}`);return response.json();}
if(process.argv[2]==='create'){
  const p=JSON.parse(await readFile(new URL('../../examples/mard-demo-3x2.json',import.meta.url),'utf8'));p.patternId='persistence-'+randomUUID();p.title='持久化验证（临时）';await call('/patterns','POST',p);
  await call('/patterns/'+p.patternId+'/edits/commit','POST',{baseRevision:1,idempotencyKey:randomUUID(),operations:[{type:'set_cell',x:1,y:1,newColor:'H2'}]});await writeFile(marker,JSON.stringify({id:p.patternId}));console.log('Persistence probe saved at revision 2.');
}else{
  const {id}=JSON.parse(await readFile(marker,'utf8')),state=await call('/patterns/'+id);assert.equal(state.pattern.revision,2);assert.equal(state.pattern.grid.cells[0][0],'H2');assert.equal(state.canUndo,true);await call('/patterns/'+id,'DELETE');console.log('Restart persistence verified; temporary probe removed.');
}
