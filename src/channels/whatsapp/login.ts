import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fetchLatestWaWebVersion } from '@whiskeysockets/baileys';
import { createWaSocket, waitForConnection, getDefaultAuthDir, isAuthenticated } from './session.js';

export type LoginResult = { success: boolean; error?: string; selfJid?: string };
const DEFAULT_LOGIN_TIMEOUT_MS = 180000;

export async function loginWhatsApp(authDir?: string, onQr?: (qr: string) => void): Promise<LoginResult> {
  const dir = authDir || getDefaultAuthDir();
  mkdirSync(dir, { recursive: true });

  console.log('Connecting to WhatsApp... scan QR code when it appears.');

  const credsPath = join(dir, 'creds.json');
  if (existsSync(credsPath) && !isAuthenticated(dir)) {
    console.warn('Found stale WhatsApp auth state. Resetting auth files before login.');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }

  const envTimeout = Number(process.env.WHATSAPP_LOGIN_TIMEOUT_MS);
  const loginTimeoutMs = Number.isFinite(envTimeout) && envTimeout > 0
    ? envTimeout
    : DEFAULT_LOGIN_TIMEOUT_MS;

  let qrSeen = false;
  let lastCloseCode: number | undefined;
  let lastCloseMessage: string | undefined;

  const runLoginAttempt = async (version?: [number, number, number]) => {
    const maxRestartRetries = 3;
    for (let restartAttempt = 0; restartAttempt <= maxRestartRetries; restartAttempt++) {
      lastCloseCode = undefined;
      lastCloseMessage = undefined;

      const sock = await createWaSocket({
        authDir: dir,
        version,
        onQr: (qr) => {
          qrSeen = true;
          if (onQr) {
            onQr(qr);
          } else {
            try {
              const qrt = require('qrcode-terminal');
              qrt.generate(qr, { small: true });
            } catch {
              console.log('QR code:', qr);
            }
          }
        },
        onConnection: (state, err) => {
          if (state === 'open') {
            console.log('WhatsApp connected!');
          } else if (state === 'close') {
            const code = (err as any)?.output?.statusCode as number | undefined;
            lastCloseCode = code;
            lastCloseMessage = err?.message;
            console.log('Connection closed:', code ? `${err?.message} (${code})` : err?.message);
          }
        },
      });

      try {
        await waitForConnection(sock, loginTimeoutMs);
      } catch (err) {
        try {
          sock.end(undefined);
        } catch {}

        if (lastCloseCode === 515 && restartAttempt < maxRestartRetries) {
          console.warn(`WhatsApp requested restart (515). Reconnecting (${restartAttempt + 1}/${maxRestartRetries})...`);
          await new Promise(resolve => setTimeout(resolve, 1200));
          continue;
        }

        throw err;
      }

      const selfJid = (sock as any).authState?.creds?.me?.id;
      console.log(`Logged in as: ${selfJid || 'unknown'}`);
      sock.end(undefined);
      return { success: true, selfJid } as LoginResult;
    }

    throw new Error('Connection failed after restart retries');
  };

  try {
    return await runLoginAttempt();
  } catch (err) {
    // Known WA drift case: server closes early with 405 before QR appears.
    // Retry once with the latest WA web version payload.
    if (lastCloseCode === 405 && !qrSeen) {
      try {
        const latest = await fetchLatestWaWebVersion({});
        const version = latest.version as [number, number, number];
        console.warn(`WhatsApp returned 405 before QR. Retrying with WA version ${version.join('.')} (isLatest=${latest.isLatest}).`);
        return await runLoginAttempt(version);
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        return {
          success: false,
          error: `Connection closed: ${lastCloseCode}${lastCloseMessage ? ` (${lastCloseMessage})` : ''}. Retried with latest WA version but failed: ${retryMsg}`,
        };
      }
    }

    let error = err instanceof Error ? err.message : String(err);
    if (error.includes('timed out') && !qrSeen) {
      error += '. QR was not generated. Check internet/firewall access to WhatsApp Web and retry.';
    }
    if (lastCloseCode) {
      error = `Connection closed: ${lastCloseCode}${lastCloseMessage ? ` (${lastCloseMessage})` : ''}${error ? ` - ${error}` : ''}`;
    }
    return { success: false, error };
  }
}

export async function logoutWhatsApp(authDir?: string): Promise<void> {
  const dir = authDir || getDefaultAuthDir();
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log('WhatsApp session removed.');
  } else {
    console.log('No WhatsApp session found.');
  }
}

export function isWhatsAppLinked(authDir?: string): boolean {
  const dir = authDir || getDefaultAuthDir();
  return isAuthenticated(dir);
}
