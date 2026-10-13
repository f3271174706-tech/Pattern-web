import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
try{
  const page=await browser.newPage({viewport:{width:1600,height:1040},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading',{name:'窗台小花园 · MARD',exact:true}).waitFor();
  await page.getByRole('button',{name:'适应画布',exact:true}).click();
  await page.waitForTimeout(500);
  await mkdir('output',{recursive:true});
  await page.screenshot({path:'output/workbench.png'});
  await page.getByRole('button',{name:'材料统计',exact:true}).click();
  await page.screenshot({path:'output/workbench-materials.png'});
  console.log(JSON.stringify({errors,screenshots:['output/workbench.png','output/workbench-materials.png']}));
}finally{await browser.close();}
