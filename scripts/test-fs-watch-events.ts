import assert from 'node:assert/strict';
import { fsWatchDirectory, rememberFsWatchEvent, type FsWatchEvent } from '../src/gateway/fs-watch-events.js';

assert.equal(fsWatchDirectory(null), '');
assert.equal(fsWatchDirectory('root.txt'), '');
assert.equal(fsWatchDirectory('src/one.ts'), 'src');
assert.equal(fsWatchDirectory('src\\nested\\two.ts'), 'src/nested');

const pending = new Map<string, FsWatchEvent>();
rememberFsWatchEvent(pending, { eventType: 'change', filename: 'src/one.ts' });
rememberFsWatchEvent(pending, { eventType: 'rename', filename: 'test/two.ts' });
rememberFsWatchEvent(pending, { eventType: 'change', filename: 'src/three.ts' });

assert.equal(pending.size, 2);
assert.equal(pending.get('src')?.filename, 'src/three.ts');
assert.equal(pending.get('test')?.filename, 'test/two.ts');

console.log('fs watch event batching: passed');
