import assert from 'node:assert/strict';
import { getDb } from '../src/db.js';
import { SessionManager, sdkMessageToSession, type SessionMessage } from '../src/session/manager.js';

const config = {} as any;
const sessionManager = new SessionManager(config);
const db = getDb();

const sessionId = 'session-sanitization-test';

const toolResultMessage: SessionMessage = {
  type: 'user',
  timestamp: '2026-05-01T00:00:00.000Z',
  content: {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_test',
          content: [
            { type: 'text', text: 'screenshot saved' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
          ],
        },
      ],
    },
  },
};

sessionManager.append(sessionId, toolResultMessage);

let row = db.prepare('SELECT content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId) as {
  content: string;
};
assert.equal(row.content.includes('abc123'), false);
assert.equal(row.content.includes('screenshot saved'), true);

const storedToolResult = JSON.parse(row.content);
assert.deepEqual(storedToolResult.message.content[0].content, [
  { type: 'text', text: 'screenshot saved' },
]);

const userImageMessage: SessionMessage = {
  type: 'user',
  timestamp: '2026-05-01T00:00:01.000Z',
  content: {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'keepme' } },
        { type: 'text', text: 'look at this' },
      ],
    },
  },
};

sessionManager.append(sessionId, userImageMessage);

row = db.prepare('SELECT content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId) as {
  content: string;
};
assert.equal(row.content.includes('keepme'), true);

const sanitizedSdkMessage = sdkMessageToSession({
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_sdk',
        content: [
          { type: 'text', text: 'done' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'gone' } },
        ],
      },
    ],
  },
});

assert.ok(sanitizedSdkMessage);
assert.equal(JSON.stringify(sanitizedSdkMessage?.content).includes('gone'), false);

const savedSessionId = 'session-sanitization-save-test';
sessionManager.save(savedSessionId, [toolResultMessage]);
const savedRow = db.prepare('SELECT content FROM messages WHERE session_id = ? LIMIT 1').get(savedSessionId) as {
  content: string;
};
assert.equal(savedRow.content.includes('abc123'), false);

console.log('session sanitization ok');
