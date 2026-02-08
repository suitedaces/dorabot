// convert markdown to whatsapp-compatible formatting
// whatsapp supports: *bold*, _italic_, ~strikethrough~, ```code```, `inline`, > quote

export function markdownToWhatsApp(text: string): string {
  let result = text;

  // protect code blocks (```lang\ncode\n```) — whatsapp uses same syntax
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `\x00CB${idx}\x00`;
  });

  // protect inline code (`code`) — whatsapp uses same syntax
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (match) => {
    const idx = inlineCodes.length;
    inlineCodes.push(match);
    return `\x00IC${idx}\x00`;
  });

  // strip HTML tags that telegram might have added
  result = result.replace(/<\/?(?:b|i|s|u|code|pre|a|blockquote|tg-spoiler)[^>]*>/g, '');

  // markdown links [text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // bold **text** or __text__ → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');
  result = result.replace(/__(.+?)__/g, '*$1*');

  // italic *text* → _text_ (careful not to match already-converted *bold*)
  // only convert single * that wasn't doubled
  result = result.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '_$1_');

  // strikethrough ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // headings → bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // restore protected blocks
  result = result.replace(/\x00CB(\d+)\x00/g, (_, idx) => codeBlocks[Number(idx)]);
  result = result.replace(/\x00IC(\d+)\x00/g, (_, idx) => inlineCodes[Number(idx)]);

  return result;
}
