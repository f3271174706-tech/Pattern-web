import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import palette from '../examples/palettes/mard221.json';
import source from '../examples/palettes/mard221.source.json';
import {createMardDemo,createMardSmallDemo} from '../packages/core/src/mard-demo';
import {buildApp} from '../apps/api/src/app';
import {validatePattern} from '../packages/core/src/index';
it('retains the supplied Excel identity and all 221 color mappings exactly',()=>{
  const file=readFileSync(new URL('../examples/palettes/Mard221_色号HEX_带颜色.xlsx',import.meta.url));
  expect(createHash('sha256').update(file).digest('hex')).toBe(source.sha256);
  expect(Object.keys(palette.colors)).toHaveLength(221);
  expect(source.rows.map(r=>r.code)).toEqual(Object.keys(palette.colors));
  expect(palette.colors.A1.hex).toBe('#FAF4C8');expect(palette.colors.H2.hex).toBe('#FEFFFF');
  for(const p of [createMardDemo(),createMardSmallDemo()]){
    validatePattern(p);expect(p.palette).toEqual(palette);
    for(const row of p.grid.cells)for(const code of row)if(code!==null)expect(Object.hasOwn(palette.colors,code)).toBe(true);
  }
});
it('a fresh workbench only lists examples bound to the user MARD 221 palette',async()=>{
  const app=await buildApp({databasePath:':memory:'});
  try{const list=(await app.inject('/api/v1/patterns')).json();expect(list).toHaveLength(2);
    for(const project of list){expect(project.palette).toBe('MARD-221');const p=(await app.inject(`/api/v1/patterns/${project.id}`)).json().pattern;expect(p.palette).toEqual(palette);}
  }finally{await app.close();}
});
