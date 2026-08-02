import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveWithinRoot, safeHost } from './preview-paths';

const ROOT = '/tmp/preview-root';

describe('resolveWithinRoot', () => {
  it('serves files in the approved folder', () => {
    expect(resolveWithinRoot(ROOT, '/index.html')).toBe(path.join(ROOT, 'index.html'));
    expect(resolveWithinRoot(ROOT, '/assets/app.js')).toBe(path.join(ROOT, 'assets/app.js'));
  });

  it('serves the root itself', () => {
    expect(resolveWithinRoot(ROOT, '/')).toBe(ROOT);
  });

  it('decodes percent-encoded names', () => {
    expect(resolveWithinRoot(ROOT, '/my%20file.html')).toBe(path.join(ROOT, 'my file.html'));
  });

  it('refuses traversal out of the root', () => {
    expect(resolveWithinRoot(ROOT, '/../secrets.txt')).toBeNull();
    expect(resolveWithinRoot(ROOT, '/../../etc/passwd')).toBeNull();
    expect(resolveWithinRoot(ROOT, '/assets/../../etc/passwd')).toBeNull();
  });

  it('refuses encoded traversal', () => {
    expect(resolveWithinRoot(ROOT, '/%2e%2e/secrets.txt')).toBeNull();
    expect(resolveWithinRoot(ROOT, '/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).toBeNull();
  });

  it('refuses a sibling folder that merely shares the prefix', () => {
    expect(resolveWithinRoot(ROOT, '/../preview-root-evil/x')).toBeNull();
  });

  it('refuses absolute escapes and null bytes', () => {
    expect(resolveWithinRoot(ROOT, '//etc/passwd')).toBe(path.join(ROOT, 'etc/passwd'));
    expect(resolveWithinRoot(ROOT, '/a%00b')).toBeNull();
  });

  it('refuses malformed percent encoding instead of throwing', () => {
    expect(() => resolveWithinRoot(ROOT, '/%')).not.toThrow();
    expect(resolveWithinRoot(ROOT, '/%')).toBeNull();
  });
});

describe('safeHost', () => {
  it('pulls the token out of a preview url', () => {
    expect(safeHost('dorabot-preview://abc-123/index.html')).toBe('abc-123');
  });

  it('returns empty for junk instead of throwing', () => {
    expect(safeHost('not a url')).toBe('');
    expect(safeHost('')).toBe('');
  });
});
