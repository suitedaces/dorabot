import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskUserQuestionPanel } from './Chat';

const single = {
  question: 'Which db?', header: 'DB', multiSelect: false,
  options: [{ label: 'Postgres', description: '' }, { label: 'SQLite', description: '' }, { label: 'Mongo', description: '' }],
};
const multi = {
  question: 'Which features?', header: 'Features', multiSelect: true,
  options: [{ label: 'Auth', description: '' }, { label: 'Search', description: '' }, { label: 'Billing', description: '' }],
};

function setup(questions: any[]) {
  const onAnswer = vi.fn();
  const onDismiss = vi.fn();
  const utils = render(<AskUserQuestionPanel question={{ requestId: 'r1', questions }} onAnswer={onAnswer} onDismiss={onDismiss} />);
  const panel = utils.container.firstElementChild as HTMLElement;
  const key = (k: string, opts: Record<string, unknown> = {}) => act(() => { fireEvent.keyDown(document.activeElement || panel, { key: k, ...opts }); });
  return { ...utils, panel, onAnswer, key };
}

afterEach(() => cleanup());

describe('AskUserQuestionPanel keyboard', () => {
  it('takes focus when it appears and gives it back when it goes away', () => {
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    const { panel, unmount } = setup([single]);
    expect(document.activeElement).toBe(panel);
    unmount();
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('number picks an option and Return answers', () => {
    const { key, onAnswer } = setup([single]);
    key('2');
    key('Enter');
    expect(onAnswer).toHaveBeenCalledWith('r1', { 'Which db?': 'SQLite' });
  });

  it('Return does nothing until something is picked', () => {
    const { key, onAnswer } = setup([single]);
    key('Enter');
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('arrows move the highlight and Space toggles in multi-select', () => {
    const { key, onAnswer } = setup([multi]);
    key(' ');            // Auth
    key('ArrowDown');
    key('ArrowDown');
    key(' ');            // Billing
    key('1');            // Auth off again
    key('Enter');
    expect(onAnswer).toHaveBeenCalledWith('r1', { 'Which features?': 'Billing' });
  });

  it('Return goes to the next question, ArrowLeft goes back, Esc skips', () => {
    const { key, onAnswer } = setup([single, multi]);
    key('1');
    key('Enter');
    expect(screen.getByText(/Which features\?/)).toBeTruthy();
    key('ArrowLeft');
    expect(screen.getByText(/Which db\?/)).toBeTruthy();
    key('Enter');
    key('Escape');
    expect(onAnswer).toHaveBeenCalledWith('r1', { 'Which db?': 'Postgres', 'Which features?': '' });
  });

  it('digits typed into Other stay in the text box', () => {
    const { key, onAnswer } = setup([single]);
    key('4');            // Other
    const input = screen.getByPlaceholderText('type your answer...') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    act(() => { fireEvent.change(input, { target: { value: 'redis 7' } }); });
    key('1');
    key('Enter');
    expect(onAnswer).toHaveBeenCalledWith('r1', { 'Which db?': 'redis 7' });
  });

  it('shows number hints next to options', () => {
    setup([single]);
    for (const n of ['1', '2', '3', '4']) expect(screen.getByText(n)).toBeTruthy();
  });
});
