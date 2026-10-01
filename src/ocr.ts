import type { PaddleOCR, OcrResult } from '@paddleocr/paddleocr-js';

type Engine = Awaited<ReturnType<typeof PaddleOCR.create>>;
let engine: Engine | null = null;
let worker: Worker | null = null;

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { resetOcr(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function resetOcr() {
  worker?.terminate();
  worker = null;
  engine = null;
}

export async function readImage(source: HTMLCanvasElement, signal: AbortSignal, update: (message: string) => void): Promise<OcrResult> {
  try {
    if (!engine) {
      update('正在加载本地 OCR 引擎，首次使用需要稍等…');
      const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
      signal.throwIfAborted();
      const runtime = new URL(`${import.meta.env.BASE_URL}runtime/`, window.location.href).href;
      engine = await PaddleOCR.create({
        initialize: false,
        worker: { createWorker: () => {
          worker = new Worker(`${runtime}paddle-ocr-worker.js`, { type: 'module' });
          return worker;
        } },
        textDetectionModelName: 'PP-OCRv5_mobile_det',
        textRecognitionModelName: 'PP-OCRv5_mobile_rec',
        textDetectionModelAsset: { url: `${runtime}PP-OCRv5_mobile_det_onnx_infer.tar` },
        textRecognitionModelAsset: { url: `${runtime}PP-OCRv5_mobile_rec_onnx_infer.tar` },
        ortOptions: { backend: 'wasm', wasmPaths: runtime, numThreads: 1, proxy: false },
      });
      await abortable(engine.initialize(), signal);
    }
    signal.throwIfAborted();
    update('正在识别式神名称与属性数字…');
    const results = await abortable(engine.predict(source, {
      textDetLimitSideLen: 1600,
      textDetLimitType: 'max',
      textRecScoreThresh: 0.3,
      textDetBoxThresh: 0.45,
    }), signal);
    if (!results[0]) throw new Error('OCR 没有返回结果');
    return results[0];
  } catch (error) {
    if (!signal.aborted) resetOcr();
    throw error;
  }
}
