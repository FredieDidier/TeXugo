// pdf_viewer.mjs reads the core library from globalThis.pdfjsLib, so this
// module must be evaluated before it.
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
globalThis.pdfjsLib = pdfjsLib;
export default pdfjsLib;
