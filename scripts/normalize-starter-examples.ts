import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { PatternStore, digestOf } from '../apps/api/src/store';
import { createDemo, createSmallDemo } from '../packages/core/src/demo';
import { createMardDemo, createMardSmallDemo } from '../packages/core/src/mard-demo';
// Remove only our exact, unedited starter fixtures after an online SQLite backup.
// Never reassign codes or palettes in a user's imported or edited project.
const path=resolve(process.argv[2]??'data/workbench.sqlite');
const stamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
const backupPath=join(dirname(path),'backups',`before-mard-starters-${stamp}.sqlite`);
await mkdir(dirname(backupPath),{recursive:true});
const source=new DatabaseSync(path);await backup(source,backupPath);source.close();
const store=new PatternStore(path),removed:string[]=[],preserved:string[]=[];
try{
  for(const fixture of [createSmallDemo(),createDemo()]){
    const present=store.list().find(p=>p.id===fixture.patternId);if(!present)continue;
    if(present.revision===1&&digestOf(store.get(fixture.patternId))===digestOf(fixture)){
      store.delete(fixture.patternId);removed.push(fixture.patternId);
    }else preserved.push(fixture.patternId);
  }
  for(const fixture of [createMardSmallDemo(),createMardDemo()]){
    if(!store.list().some(p=>p.id===fixture.patternId))store.create(fixture);
  }
  console.log(JSON.stringify({backupPath,removed,preserved,projects:store.list().map(p=>({id:p.id,palette:p.palette}))}));
}finally{store.close();}
