import { mkdir, readdir, copyFile, readFile, stat, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'public/runtime');
await mkdir(output, { recursive: true });
const sdkPath = path.join(root, 'node_modules/@paddleocr/paddleocr-js');
const ortPath = path.join(root, 'node_modules/onnxruntime-web');
const ortPackage = JSON.parse(await readFile(path.join(ortPath, 'package.json'), 'utf8'));
// The SDK's prebuilt worker embeds ONNX Runtime 1.24.3. Its WASM must match.
if (ortPackage.version !== '1.24.3') throw new Error('OCR worker requires onnxruntime-web 1.24.3; run npm ci.');
const workerName = (await readdir(path.join(sdkPath, 'dist/assets'))).find((name) => /^worker-entry-.*\.js$/.test(name));
if (!workerName) throw new Error('PaddleOCR worker asset not found.');
await copyFile(path.join(sdkPath, 'dist/assets', workerName), path.join(output, 'paddle-ocr-worker.js'));
for (const name of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  await copyFile(path.join(ortPath, 'dist', name), path.join(output, name));
}
for (const [folder, name] of [[sdkPath, 'PaddleOCR-LICENSE'], [ortPath, 'ONNX-Runtime-LICENSE']]) {
  const source = (await readdir(folder)).find((file) => /^LICENSE(?:\..*)?$/i.test(file));
  if (source) await copyFile(path.join(folder, source), path.join(output, name));
}
for (const model of ['PP-OCRv5_mobile_det', 'PP-OCRv5_mobile_rec']) {
  const file = `${model}_onnx_infer.tar`;
  const destination = path.join(output, file);
  if (await stat(destination).then((info) => info.size > 1024).catch(() => false)) continue;
  console.log(`Downloading pretrained model: ${model}`);
  const response = await fetch(`https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/${file}`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);
  const temporary = `${destination}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    const header = Buffer.alloc(512);
    const { open } = await import('node:fs/promises');
    const handle = await open(temporary);
    try { await handle.read(header, 0, 512, 0); } finally { await handle.close(); }
    if (header.toString('ascii', 257, 262) !== 'ustar') throw new Error(`Invalid model archive: ${file}`);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
console.log('Local OCR runtime ready. Models are reused on subsequent starts.');
