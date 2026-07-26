// Exercises the real fs-ops functions the fs.* RPCs call.
// Run: npx tsx scripts/test-fs-ops.ts
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uniqueDestination, isInside, moveToTrash, copyPath, movePath } from '../src/gateway/fs-ops.js';

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

function throws(name: string, fn: () => unknown, match: RegExp) {
  try {
    fn();
    console.log(`  FAIL  ${name}\n          expected throw matching ${match}`);
    fail++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const ok = match.test(msg);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n          threw ${msg}, wanted ${match}`}`);
    ok ? pass++ : fail++;
  }
}

const root = mkdtempSync(join(tmpdir(), 'fsops-'));
const name = (p: string) => p.slice(p.lastIndexOf('/') + 1);

console.log('\nuniqueDestination');
{
  const d = join(root, 'uniq');
  mkdirSync(d);
  check('free name untouched', name(uniqueDestination(join(d, 'a.ts'))), 'a.ts');

  writeFileSync(join(d, 'a.ts'), '');
  check('first collision', name(uniqueDestination(join(d, 'a.ts'))), 'a copy.ts');

  writeFileSync(join(d, 'a copy.ts'), '');
  check('second collision', name(uniqueDestination(join(d, 'a.ts'))), 'a copy 2.ts');

  writeFileSync(join(d, 'notes'), '');
  check('no extension', name(uniqueDestination(join(d, 'notes'))), 'notes copy');

  writeFileSync(join(d, '.env'), '');
  check('dotfile keeps leading dot', name(uniqueDestination(join(d, '.env'))), '.env copy');

  writeFileSync(join(d, 'bundle.tar.gz'), '');
  check('multi-part extension', name(uniqueDestination(join(d, 'bundle.tar.gz'))), 'bundle copy.tar.gz');

  mkdirSync(join(d, 'src'));
  check('directory collision', name(uniqueDestination(join(d, 'src'))), 'src copy');
}

console.log('\nisInside');
{
  check('same path', isInside('/a/b', '/a/b'), true);
  check('nested', isInside('/a/b', '/a/b/c'), true);
  check('sibling', isInside('/a/b', '/a/c'), false);
  check('prefix but not nested', isInside('/a/b', '/a/bc'), false);
}

console.log('\ncopyPath');
{
  const d = join(root, 'copy');
  mkdirSync(d);
  writeFileSync(join(d, 'src.txt'), 'content');
  const c1 = copyPath(join(d, 'src.txt'), join(d, 'dst.txt'));
  check('copies content', readFileSync(c1, 'utf8'), 'content');

  const c2 = copyPath(join(d, 'src.txt'), join(d, 'dst.txt'));
  check('collision auto-renames', name(c2), 'dst copy.txt');
  check('original survives collision', readFileSync(join(d, 'dst.txt'), 'utf8'), 'content');

  writeFileSync(join(d, 'over.txt'), 'old');
  copyPath(join(d, 'src.txt'), join(d, 'over.txt'), true);
  check('overwrite replaces', readFileSync(join(d, 'over.txt'), 'utf8'), 'content');

  mkdirSync(join(d, 'tree/nested'), { recursive: true });
  writeFileSync(join(d, 'tree/nested/deep.txt'), 'deep');
  const c3 = copyPath(join(d, 'tree'), join(d, 'tree-copy'));
  check('recursive directory copy', readFileSync(join(c3, 'nested/deep.txt'), 'utf8'), 'deep');

  throws('refuses copy into itself', () => copyPath(join(d, 'tree'), join(d, 'tree/inner')), /into itself/);
}

console.log('\nmovePath');
{
  const d = join(root, 'move');
  mkdirSync(join(d, 'folder'), { recursive: true });
  writeFileSync(join(d, 'a.txt'), 'A');

  const m1 = movePath(join(d, 'a.txt'), join(d, 'folder/a.txt'));
  check('moves into folder', readFileSync(m1, 'utf8'), 'A');
  check('source removed', existsSync(join(d, 'a.txt')), false);

  writeFileSync(join(d, 'a.txt'), 'B');
  throws('fail policy refuses collision', () => movePath(join(d, 'a.txt'), join(d, 'folder/a.txt')), /already exists/);
  check('failed move leaves source', readFileSync(join(d, 'a.txt'), 'utf8'), 'B');
  check('failed move leaves target', readFileSync(join(d, 'folder/a.txt'), 'utf8'), 'A');

  const m2 = movePath(join(d, 'a.txt'), join(d, 'folder/a.txt'), 'rename');
  check('rename policy keeps both', name(m2), 'a copy.txt');
  check('original target intact', readFileSync(join(d, 'folder/a.txt'), 'utf8'), 'A');

  writeFileSync(join(d, 'a.txt'), 'C');
  movePath(join(d, 'a.txt'), join(d, 'folder/a.txt'), 'overwrite');
  check('overwrite policy replaces', readFileSync(join(d, 'folder/a.txt'), 'utf8'), 'C');

  throws('refuses move into itself', () => movePath(join(d, 'folder'), join(d, 'folder/sub')), /into itself/);
}

console.log('\nmoveToTrash (fake trash dir, no ~/.Trash pollution)');
{
  const d = join(root, 'trash');
  const fakeTrash = join(root, 'FakeTrash');
  mkdirSync(d, { recursive: true });
  mkdirSync(fakeTrash);

  writeFileSync(join(d, 'gone.txt'), 'bye');
  const t1 = moveToTrash(join(d, 'gone.txt'), fakeTrash);
  check('source removed', existsSync(join(d, 'gone.txt')), false);
  check('recoverable from trash', readFileSync(t1, 'utf8'), 'bye');

  writeFileSync(join(d, 'gone.txt'), 'second');
  const t2 = moveToTrash(join(d, 'gone.txt'), fakeTrash);
  check('same name twice does not clobber', name(t2), 'gone copy.txt');
  check('first trashed file intact', readFileSync(t1, 'utf8'), 'bye');

  mkdirSync(join(d, 'dir/inner'), { recursive: true });
  writeFileSync(join(d, 'dir/inner/x.txt'), 'x');
  const t3 = moveToTrash(join(d, 'dir'), fakeTrash);
  check('directory trashed whole', readFileSync(join(t3, 'inner/x.txt'), 'utf8'), 'x');

  check('trash contents', readdirSync(fakeTrash).sort(), ['dir', 'gone copy.txt', 'gone.txt']);

  throws('missing trash dir errors', () => moveToTrash(join(d, 'nope'), join(root, 'NoSuchTrash')), /does not exist/);
}

rmSync(root, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
