import React, { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_PREVIEW_EVENT } from '@/lib/file-preview';
import { FileViewer } from './FileViewer';

const mocks = vi.hoisted(() => ({
  flush: vi.fn<() => Promise<void>>(),
  toastError: vi.fn(),
}));

vi.mock('./viewers/MonacoEditor', () => ({
  MonacoEditor: forwardRef(function MockMonacoEditor(_props, ref) {
    useImperativeHandle(ref, () => ({ flush: mocks.flush }));
    return <div>editor</div>;
  }),
}));

vi.mock('./viewers/JsonViewer', () => ({
  JsonViewer: () => <div>json preview</div>,
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError },
}));

afterEach(cleanup);

beforeEach(() => {
  mocks.flush.mockReset();
  mocks.flush.mockResolvedValue();
  mocks.toastError.mockReset();
});

describe('file preview transitions', () => {
  it('waits for the editor buffer to save before unmounting it', async () => {
    let finishSave: (() => void) | undefined;
    mocks.flush.mockImplementationOnce(() => new Promise<void>(resolve => {
      finishSave = resolve;
    }));
    const rpc = vi.fn(async () => ({ content: '{"ready":true}' }));

    render(<FileViewer filePath="/tmp/data.json" rpc={rpc} onClose={() => {}} headerless />);
    await screen.findByText('json preview');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByText('editor');

    window.dispatchEvent(new CustomEvent(FILE_PREVIEW_EVENT, {
      detail: { filePath: '/tmp/data.json' },
    }));

    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(screen.getByText('editor')).toBeTruthy();

    await act(async () => finishSave?.());
    await waitFor(() => expect(screen.getByText('json preview')).toBeTruthy());
  });

  it('stays in the editor when saving fails', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('disk full'));
    const rpc = vi.fn(async () => ({ content: '<main>hello</main>' }));

    render(<FileViewer filePath="/tmp/page.html" rpc={rpc} onClose={() => {}} headerless />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByText('editor');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(screen.getByText('editor')).toBeTruthy();
  });
});
