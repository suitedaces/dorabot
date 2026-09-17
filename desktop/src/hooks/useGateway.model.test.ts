import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// shared state has to be hoisted: the mock factory runs when useGateway imports the client,
// which happens before top-level consts in this file are initialised
const h = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: Record<string, unknown> | undefined }>,
  emit: null as null | ((n: unknown) => void),
}));

vi.mock('../gateway/client', () => ({
  getGatewayClient: () => ({
    connectionState: 'connected',
    connect: () => {},
    disconnect: () => {},
    subscribe: (listener: (n: unknown) => void) => {
      h.emit = listener;
      return () => {};
    },
    rpc: async (method: string, params?: Record<string, unknown>) => {
      h.calls.push({ method, params });
      if (method === 'config.get') return { model: CONFIG_MODEL };
      if (method === 'sessions.list') return [];
      return {};
    },
  }),
}));

import { useGateway } from './useGateway';

const CONFIG_MODEL = 'claude-sonnet-4-6';
const KEY_A = 'desktop:dm:chat-a';
const KEY_B = 'desktop:dm:chat-b';

function sends() {
  return h.calls.filter(c => c.method === 'chat.send');
}

function lastSendModel() {
  const all = sends();
  return all[all.length - 1]?.params?.model;
}

async function mount() {
  const hook = renderHook(() => useGateway());
  // wait for the mount-time config.get to land so the fallback model is populated
  await waitFor(() => expect(hook.result.current.model).toBe(CONFIG_MODEL));
  return hook;
}

beforeEach(() => {
  h.calls.length = 0;
  h.emit = null;
  localStorage.clear();
});

describe('model selector is the source of truth', () => {
  it('sends the model picked in a brand new chat, before any session row exists', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.selectModel(KEY_A, undefined, 'claude-opus-5');
    });
    await act(async () => {
      await result.current.sendMessage('hi', KEY_A, 'chat-a');
    });

    expect(lastSendModel()).toBe('claude-opus-5');
  });

  it('keeps two chats on different models', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.selectModel(KEY_A, undefined, 'claude-opus-5');
      await result.current.sendMessage('a', KEY_A, 'chat-a');
      await result.current.selectModel(KEY_B, undefined, 'claude-fable-5-1');
      await result.current.sendMessage('b', KEY_B, 'chat-b');
    });

    const [first, second] = sends();
    expect(first.params?.model).toBe('claude-opus-5');
    expect(second.params?.model).toBe('claude-fable-5-1');
  });

  it("a session's own model survives a later pick in a different chat", async () => {
    const { result } = await mount();

    // agent.result is ignored for untracked sessions, same as a chat tab that was never opened
    await act(async () => {
      result.current.trackSession(KEY_A);
    });

    // chat A picks opus and sends; the server then reports A's session id
    await act(async () => {
      await result.current.selectModel(KEY_A, undefined, 'claude-opus-5');
      await result.current.sendMessage('a', KEY_A, 'chat-a');
    });
    await act(async () => {
      h.emit?.({ type: 'event', payload: { event: 'agent.result', data: { sessionKey: KEY_A, sessionId: 'sid-a', result: 'ok' } } });
      h.emit?.({ type: 'event', payload: { event: 'sessions.update', data: { sessionId: 'sid-a', model: 'claude-opus-5' } } });
    });
    await waitFor(() => expect(result.current.modelsBySession['sid-a']).toBe('claude-opus-5'));

    // a different chat picks something else
    await act(async () => {
      await result.current.selectModel(KEY_B, undefined, 'claude-fable-5-1');
      await result.current.sendMessage('b', KEY_B, 'chat-b');
    });

    // back to A: it must still be on its own model, not B's
    await act(async () => {
      await result.current.sendMessage('a again', KEY_A, 'chat-a');
    });

    expect(lastSendModel()).toBe('claude-opus-5');
    expect(result.current.getSessionModel('sid-a', KEY_A)).toBe('claude-opus-5');
  });

  it('seeds a brand new chat with the last model picked anywhere', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.selectModel(KEY_A, undefined, 'claude-fable-5-1');
      await result.current.sendMessage('a', KEY_A, 'chat-a');
    });
    // a different chat that was never picked in
    await act(async () => {
      await result.current.sendMessage('fresh', KEY_B, 'chat-b');
    });

    expect(lastSendModel()).toBe('claude-fable-5-1');
    expect(result.current.getSessionModel(undefined, KEY_B)).toBe('claude-fable-5-1');
  });

  it('falls back to the config model when nothing has ever been picked', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.sendMessage('hi', KEY_A, 'chat-a');
    });

    expect(lastSendModel()).toBe(CONFIG_MODEL);
  });

  it('never writes the model into config', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.selectModel(KEY_A, undefined, 'claude-opus-5');
      await result.current.sendMessage('a', KEY_A, 'chat-a');
      await result.current.selectModel(KEY_B, undefined, 'claude-fable-5-1');
      await result.current.sendMessage('b', KEY_B, 'chat-b');
    });

    const configModelWrites = h.calls.filter(c => c.method === 'config.set' && c.params?.key === 'model');
    expect(configModelWrites).toEqual([]);
  });

  it('remembers the last pick across a remount', async () => {
    const first = await mount();
    await act(async () => {
      await first.result.current.selectModel(KEY_A, undefined, 'claude-opus-4-8');
    });
    first.unmount();

    const second = await mount();
    expect(second.result.current.getSessionModel(undefined, 'desktop:dm:brand-new')).toBe('claude-opus-4-8');
  });
});
