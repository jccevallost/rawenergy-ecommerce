// IMP-01 (M10): extracción de texto posicionado de un PDF en un hilo aparte, con memoria y tiempo acotados.
// pdf.js se ejecuta sin evaluación de código, sin fuentes del sistema, sin XFA y sin red: el PDF es un dato.
import { Worker } from "node:worker_threads";
import type { TextItem } from "./invoiceParser.js";

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 5, TIMEOUT_MS = 15_000;
const workerCode = `
import { parentPort, workerData } from "node:worker_threads";
await (async () => {
  try {
    const pdfjs = await import(workerData.pdfjsUrl);
    const task = pdfjs.getDocument({ data: workerData.data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, stopAtErrors: true, verbosity: 0 });
    const doc = await task.promise;
    if (doc.numPages > workerData.maxPages) { parentPort.postMessage({ ok: false, error: "PAGES", pages: doc.numPages }); return; }
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const { items } = await page.getTextContent();
      pages.push(items.filter(i => typeof i.str === "string").map(i => ({ x: i.transform[4], y: i.transform[5], str: i.str })));
    }
    await task.destroy();
    parentPort.postMessage({ ok: true, pages });
  } catch (error) { parentPort.postMessage({ ok: false, error: String(error && error.name || error), detail: String(error && error.message) }); }
})();`;

export type PdfText = { pages: TextItem[][] };
const messages: Record<string, string> = {
  PasswordException: "El PDF está protegido con contraseña. Descarga la factura sin protección o regístrala a mano.",
  InvalidPDFException: "El archivo no es un PDF válido o está dañado.",
  PAGES: `La factura tiene más de ${MAX_PAGES} páginas; la importación piloto admite facturas cortas.`,
  TIMEOUT: "El PDF tardó demasiado en leerse. Intenta de nuevo o regístralo a mano.",
  MEMORY: "El PDF es demasiado complejo para leerlo de forma segura."
};

export async function extractPdfText(data: Buffer): Promise<PdfText> {
  if (data.length > MAX_PDF_BYTES) throw new Error("El PDF supera 5 MB.");
  if (data.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error(messages.InvalidPDFException);
  const pdfjsUrl = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = new Worker(workerCode, { eval: true, workerData: { pdfjsUrl, data: new Uint8Array(data), maxPages: MAX_PAGES }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, codeRangeSizeMb: 16 }, stdout: true, stderr: true });
  try {
    const result = await new Promise<{ ok: boolean; pages?: TextItem[][]; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(messages.TIMEOUT)), TIMEOUT_MS);
      worker.once("message", message => { clearTimeout(timer); resolve(message); });
      worker.once("error", error => { clearTimeout(timer); reject(new Error((error as { code?: string }).code === "ERR_WORKER_OUT_OF_MEMORY" ? messages.MEMORY : messages.InvalidPDFException)); });
      worker.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error(messages.MEMORY)); });
    });
    if (!result.ok) { if (process.env.PDF_DEBUG) console.error("[pdf]", result.error, (result as { detail?: string }).detail); throw new Error(messages[result.error ?? ""] ?? messages.InvalidPDFException); }
    return { pages: result.pages ?? [] };
  } finally { await worker.terminate(); }
}
