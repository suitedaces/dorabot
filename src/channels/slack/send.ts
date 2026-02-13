import { markdownToSlackMrkdwn, splitSlackMessage } from './format.js';

// WebClient from @slack/web-api (accessed via app.client in @slack/bolt)
// Using 'any' to avoid requiring @slack/bolt types at compile time,
// since the package is dynamically imported only when slack is enabled.
type SlackClient = any;

export async function sendSlackMessage(
  client: SlackClient,
  target: string,
  text: string,
  opts?: { replyTo?: string; media?: string },
): Promise<{ id: string; chatId: string }> {
  const mrkdwn = markdownToSlackMrkdwn(text);
  const chunks = splitSlackMessage(mrkdwn);

  // if media is provided, upload it as an initial message
  if (opts?.media) {
    const result = await client.filesUploadV2({
      channel_id: target,
      file: opts.media,
      initial_comment: chunks[0] || undefined,
      thread_ts: opts.replyTo || undefined,
    });
    // filesUploadV2 returns file info; get the message ts from the share
    const fileObj = result?.file || result?.files?.[0];
    const ts = fileObj?.shares?.public?.[target]?.[0]?.ts
      || fileObj?.shares?.private?.[target]?.[0]?.ts
      || '';
    // send remaining chunks if any
    for (let i = 1; i < chunks.length; i++) {
      await client.chat.postMessage({
        channel: target,
        text: chunks[i],
        thread_ts: opts.replyTo || undefined,
      });
    }
    return { id: ts, chatId: target };
  }

  // send first chunk
  const result = await client.chat.postMessage({
    channel: target,
    text: chunks[0],
    thread_ts: opts?.replyTo || undefined,
  });

  const ts = result.ts || '';

  // send remaining chunks
  for (let i = 1; i < chunks.length; i++) {
    await client.chat.postMessage({
      channel: target,
      text: chunks[i],
      thread_ts: opts?.replyTo || undefined,
    });
  }

  return { id: ts, chatId: target };
}

export async function editSlackMessage(
  client: SlackClient,
  chatId: string,
  messageId: string,
  newText: string,
): Promise<void> {
  const mrkdwn = markdownToSlackMrkdwn(newText);
  const chunks = splitSlackMessage(mrkdwn);

  // update the original message with the first chunk
  await client.chat.update({
    channel: chatId,
    ts: messageId,
    text: chunks[0],
  });

  // overflow chunks sent as new messages
  for (let i = 1; i < chunks.length; i++) {
    await client.chat.postMessage({
      channel: chatId,
      text: chunks[i],
    });
  }
}

export async function deleteSlackMessage(
  client: SlackClient,
  chatId: string,
  messageId: string,
): Promise<void> {
  await client.chat.delete({
    channel: chatId,
    ts: messageId,
  });
}
