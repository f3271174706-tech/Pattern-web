import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { BeadPattern, Rect } from "../../../packages/core/src/types";
import { DomainError } from "../../../packages/core/src/index";
const root = fileURLToPath(new URL("../../../", import.meta.url));
let active = 0;
export async function exportInWorker(
  pattern: BeadPattern,
  format: "svg" | "pdf",
  digest: string,
  options: { range?: Rect; mode?: string } = {},
): Promise<string | Uint8Array> {
  if (active >= 2)
    throw new DomainError(
      "EXPORT_BUSY",
      "已有两个导出任务正在执行，请稍后重试",
      429,
    );
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(
        `
      const {parentPort,workerData}=require('node:worker_threads');
      require('tsx/cjs');
      (async()=>{
        const {pattern,format,digest,root,options}=workerData;
        if(format==='svg'){
          const {renderSvg}=require(root+'packages/core/src/scene.ts');
          parentPort.postMessage({result:renderSvg(pattern,digest,options.range,options.mode)});
        }else{
          const {readFileSync}=require('node:fs');
          const {renderPdf}=require(root+'packages/core/src/pdf.ts');
          const bytes=await renderPdf(pattern,digest,readFileSync(root+'assets/fonts/NotoSansSC-Regular.ttf'),options.range);
          parentPort.postMessage({result:bytes},[bytes.buffer]);
        }
      })().catch(e=>parentPort.postMessage({error:e.message,code:e.code,status:e.status,path:e.path}));
    `,
        { eval: true, workerData: { pattern, format, digest, root, options } },
      );
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(
          new DomainError(
            "EXPORT_TIMEOUT",
            "导出超时，请减少范围或页面数",
            503,
          ),
        );
      }, 60000);
      worker.once("message", (m) => {
        clearTimeout(timer);
        if (m.error)
          reject(
            new DomainError(
              m.code ?? "EXPORT_FAILED",
              m.error,
              m.status ?? 500,
              m.path,
            ),
          );
        else resolve(m.result);
      });
      worker.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(new DomainError("EXPORT_FAILED", "导出进程异常退出", 500));
      });
    });
  } finally {
    active--;
  }
}
