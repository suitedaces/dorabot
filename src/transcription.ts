import { execFile } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { TranscriptionConfig } from './config.js';
import { DORABOT_DIR } from './workspace.js';

const DEFAULT_PYTHON_ENV = join(DORABOT_DIR, 'transcription-env');
const DEFAULT_MODEL = 'mlx-community/parakeet-tdt-0.6b-v2';

export async function transcribeAudio(
  filePath: string,
  config?: TranscriptionConfig,
): Promise<string> {
  const engine = config?.engine ?? 'parakeet-mlx';

  if (engine === 'none') return '';

  if (engine === 'parakeet-mlx') {
    return transcribeWithParakeet(filePath, config);
  }

  if (engine === 'whisper') {
    return transcribeWithWhisper(filePath, config);
  }

  console.warn(`[transcription] unknown engine: ${engine}, skipping`);
  return '';
}

async function transcribeWithParakeet(
  filePath: string,
  config?: TranscriptionConfig,
): Promise<string> {
  const envDir = config?.pythonEnv || DEFAULT_PYTHON_ENV;
  const bin = join(envDir, 'bin', 'parakeet-mlx');

  if (!existsSync(bin)) {
    console.error(`[transcription] parakeet-mlx not found at ${bin}. Run: python3.12 -m venv ${envDir} && ${envDir}/bin/pip install parakeet-mlx`);
    return '';
  }

  const model = config?.model || DEFAULT_MODEL;
  const outDir = join(tmpdir(), 'dorabot-transcriptions');
  mkdirSync(outDir, { recursive: true });

  return new Promise((resolve) => {
    execFile(bin, [
      filePath,
      '--model', model,
      '--output-dir', outDir,
      '--output-format', 'txt',
    ], { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[transcription] parakeet-mlx failed:`, err.message);
        if (stderr) console.error(`[transcription] stderr:`, stderr);
        resolve('');
        return;
      }

      // parakeet-mlx writes a .txt file named after the input file
      const baseName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'output';
      const txtPath = join(outDir, `${baseName}.txt`);

      if (existsSync(txtPath)) {
        const text = readFileSync(txtPath, 'utf-8').trim();
        console.log(`[transcription] parakeet-mlx: ${text.length} chars from ${filePath}`);
        resolve(text);
      } else {
        // some versions print to stdout
        console.warn(`[transcription] no output file at ${txtPath}, checking stdout`);
        resolve(stdout.trim());
      }
    });
  });
}

async function transcribeWithWhisper(
  filePath: string,
  _config?: TranscriptionConfig,
): Promise<string> {
  return new Promise((resolve) => {
    execFile('whisper', [
      filePath,
      '--model', 'base',
      '--output_format', 'txt',
      '--output_dir', tmpdir(),
    ], { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[transcription] whisper failed:`, err.message);
        resolve('');
        return;
      }

      const baseName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'output';
      const txtPath = join(tmpdir(), `${baseName}.txt`);

      if (existsSync(txtPath)) {
        const text = readFileSync(txtPath, 'utf-8').trim();
        console.log(`[transcription] whisper: ${text.length} chars from ${filePath}`);
        resolve(text);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
