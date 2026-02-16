import assert from 'node:assert/strict';

type PendingQuestion = {
  requestId: string;
  questions: Array<{ question: string }>;
};

type SessionState = {
  pendingQuestion: PendingQuestion | null;
  agentStatus: string;
};

type Snapshot = {
  pendingQuestion: PendingQuestion | null;
  pendingQuestionStatus?: 'pending' | 'answered' | 'timeout' | 'cancelled' | null;
};

function applyAskUser(state: SessionState, requestId: string): SessionState {
  return {
    ...state,
    pendingQuestion: {
      requestId,
      questions: [{ question: 'Pick one' }],
    },
    agentStatus: 'waiting for input...',
  };
}

function applyQuestionState(
  state: SessionState,
  update: { requestId: string; status: 'pending' | 'answered' | 'timeout' | 'cancelled' },
): SessionState {
  if (update.status === 'pending') return state;
  if (!state.pendingQuestion) return state;
  if (state.pendingQuestion.requestId !== update.requestId) return state;
  return {
    ...state,
    pendingQuestion: null,
    agentStatus: update.status === 'answered' ? 'thinking...' : state.agentStatus,
  };
}

function hydrateFromSnapshot(state: SessionState, snapshot: Snapshot): SessionState {
  return {
    ...state,
    pendingQuestion: snapshot.pendingQuestion && (snapshot.pendingQuestionStatus ?? 'pending') === 'pending'
      ? snapshot.pendingQuestion
      : null,
  };
}

async function main(): Promise<void> {
  const requestId = 'req-123';
  let state: SessionState = { pendingQuestion: null, agentStatus: 'idle' };

  state = applyAskUser(state, requestId);
  assert.equal(state.pendingQuestion?.requestId, requestId, 'ask_user should mark pending question');

  state = applyQuestionState(state, { requestId, status: 'answered' });
  assert.equal(state.pendingQuestion, null, 'answered question should clear pending state');

  state = hydrateFromSnapshot(state, {
    pendingQuestion: {
      requestId,
      questions: [{ question: 'Pick one' }],
    },
    pendingQuestionStatus: 'answered',
  });
  assert.equal(state.pendingQuestion, null, 'answered snapshot state must not resurrect pending question');

  state = hydrateFromSnapshot(state, {
    pendingQuestion: {
      requestId: 'req-456',
      questions: [{ question: 'Another' }],
    },
    pendingQuestionStatus: 'pending',
  });
  assert.equal(state.pendingQuestion?.requestId, 'req-456', 'pending snapshot should hydrate unresolved question');

  state = applyQuestionState(state, { requestId: 'req-456', status: 'timeout' });
  assert.equal(state.pendingQuestion, null, 'timeout should clear pending question');

  console.log('ok - question lifecycle clears answered/timeout state and blocks stale snapshot resurrection');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
