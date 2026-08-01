import { describe, expect, it } from 'vitest';
import { supportsFilePreview } from './file-preview';

describe('file preview capability', () => {
  it('covers every current source-to-preview viewer', () => {
    expect(supportsFilePreview('markdown')).toBe(true);
    expect(supportsFilePreview('html')).toBe(true);
    expect(supportsFilePreview('json')).toBe(true);
  });

  it('does not turn read-only source into a preview mode', () => {
    expect(supportsFilePreview('code')).toBe(false);
    expect(supportsFilePreview('binary')).toBe(false);
  });
});
