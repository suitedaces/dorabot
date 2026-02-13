// convert markdown to Slack mrkdwn
// Slack uses: *bold*, _italic_, ~strike~, `code`, ```code block```, <url|text>

export function markdownToSlackMrkdwn(text: string): string {
  let result = text;

  // protect existing Slack-style links <url|text> so we don't mangle them
  const slackLinks: string[] = [];
  result = result.replace(/<([^>]+\|[^>]+)>/g, (match) => {
    const idx = slackLinks.length;
    slackLinks.push(match);
    return `\x00SL${idx}\x00`;
  });

  // protect code blocks first (```lang\ncode\n```)
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push('```' + code.trimEnd() + '```');
    return `\x00CB${idx}\x00`;
  });

  // protect inline code (`code`)
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push('`' + code + '`');
    return `\x00IC${idx}\x00`;
  });

  // markdown links [text](url) -> Slack links <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // bold **text** or __text__ -> *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');
  result = result.replace(/__(.+?)__/g, '*$1*');

  // italic *text* -> _text_ (only non-bold single asterisks)
  // since we already converted **bold** to *bold*, remaining single * is italic in markdown
  // but in Slack, *text* IS bold - so we need to convert markdown italic to Slack italic
  // markdown italic: single * or _ around text
  // after bold conversion, remaining single * should become _
  // however this is tricky - if user wrote *bold* in markdown, it became *bold* (slack bold) which is correct
  // if user wrote _italic_ in markdown, it stays _italic_ which is correct for Slack

  // strikethrough ~~text~~ -> ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // headings -> bold (Slack has no heading tags)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // blockquotes > text (same syntax in Slack)
  // already compatible, no conversion needed

  // restore protected blocks
  result = result.replace(/\x00CB(\d+)\x00/g, (_, idx) => codeBlocks[Number(idx)]);
  result = result.replace(/\x00IC(\d+)\x00/g, (_, idx) => inlineCodes[Number(idx)]);
  result = result.replace(/\x00SL(\d+)\x00/g, (_, idx) => slackLinks[Number(idx)]);

  return result;
}

// Slack messages have a 40,000 char limit but practically we split earlier for readability
const MSG_LIMIT = 3900;

export function splitSlackMessage(text: string, limit = MSG_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitAt = -1;

    // try paragraph break
    const paraIdx = remaining.lastIndexOf('\n\n', limit);
    if (paraIdx > limit * 0.3) {
      splitAt = paraIdx;
    }

    // try line break
    if (splitAt < 0) {
      const lineIdx = remaining.lastIndexOf('\n', limit);
      if (lineIdx > limit * 0.3) {
        splitAt = lineIdx;
      }
    }

    // try sentence break
    if (splitAt < 0) {
      const sentIdx = remaining.lastIndexOf('. ', limit);
      if (sentIdx > limit * 0.3) {
        splitAt = sentIdx + 1;
      }
    }

    // hard split as last resort
    if (splitAt < 0) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
