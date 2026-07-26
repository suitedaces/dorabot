// Filesystem mutations used by the fs.* RPCs. Kept out of the server switch so
// the behaviour is reachable by tests.
import { existsSync, renameSync, cpSync, rmSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { homedir } from 'node:os';

export type CollisionPolicy = 'fail' | 'rename' | 'overwrite';

// "name.ts" -> "name copy.ts" -> "name copy 2.ts". Mirrors Finder so a paste
// or duplicate never silently clobbers. Leading dot is treated as part of the
// stem, so ".env" becomes ".env copy" rather than " copy.env".
export function uniqueDestination(dest: string): string {
  if (!existsSync(dest)) return dest;
  const dir = dirname(dest);
  const base = dest.slice(dir.length + 1);
  const dot = base.indexOf('.', base.startsWith('.') ? 1 : 0);
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let n = 1; n < 1000; n++) {
    const suffix = n === 1 ? ' copy' : ` copy ${n}`;
    const candidate = join(dir, `${stem}${suffix}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error('could not find a free name');
}

// True when dest sits inside src, which would recurse forever on copy and
// orphan the subtree on move.
export function isInside(src: string, dest: string): boolean {
  return dest === src || dest.startsWith(src + sep);
}

// Deletes go to ~/.Trash so they stay recoverable.
//
// Deliberately NOT Finder automation ("tell application Finder to delete"):
// it needs an Automation TCC grant and blocks for minutes on the permission
// prompt, which freezes the delete. Measured at >120s before being killed.
// A rename into ~/.Trash is instant and needs no permissions. The tradeoff is
// losing Finder's Put Back; the file still sits in the Trash.
//
// Note ~/.Trash cannot be listed under TCC, but stat and rename into it work,
// which is why uniqueDestination probes paths individually instead of reading
// the directory.
export function moveToTrash(target: string, trashDir = join(homedir(), '.Trash')): string {
  if (!existsSync(trashDir)) throw new Error(`trash directory does not exist: ${trashDir}`);
  const name = target.slice(dirname(target).length + 1);
  const dest = uniqueDestination(join(trashDir, name));
  try {
    renameSync(target, dest);
  } catch (err) {
    // rename cannot cross devices
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    cpSync(target, dest, { recursive: true });
    rmSync(target, { recursive: true, force: true });
  }
  return dest;
}

export function copyPath(src: string, dest: string, overwrite = false): string {
  if (isInside(src, dest)) throw new Error('cannot copy a directory into itself');
  const final = overwrite ? dest : uniqueDestination(dest);
  cpSync(src, final, { recursive: true, errorOnExist: false });
  return final;
}

export function movePath(src: string, dest: string, onCollision: CollisionPolicy = 'fail'): string {
  if (isInside(src, dest)) throw new Error('cannot move a directory into itself');
  let target = dest;
  if (existsSync(dest)) {
    // renameSync clobbers an existing file without warning, so a drag onto a
    // name that already exists has to be resolved explicitly.
    if (onCollision === 'fail') throw new Error(`already exists: ${dest}`);
    if (onCollision === 'rename') target = uniqueDestination(dest);
  }
  renameSync(src, target);
  return target;
}
