// Markdown-to-platform conversion using `marked` for proper parsing.
// Replaces the hand-rolled regex formatters that broke on lists, tables,
// nested formatting, and edge cases.

import { Marked, type MarkedExtension, type Tokens } from 'marked';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Telegram only supports a small set of HTML tags.
const TG_ALLOWED = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler']);

/** Strip any HTML tags Telegram doesn't understand (safety net). */
function sanitizeTelegramHtml(html: string): string {
  const stack: string[] = [];
  return html.replace(/<(\/?)([a-z][a-z0-9-]*)([^>]*?)(\/?)\s*>/gi, (match, slash, tag, attrs, selfClose) => {
    const t = tag.toLowerCase();
    if (!TG_ALLOWED.has(t)) return '';
    if (selfClose) return match;
    if (slash) {
      const idx = stack.lastIndexOf(t);
      if (idx >= 0) {
        let extra = '';
        for (let i = stack.length - 1; i > idx; i--) extra += `</${stack[i]}>`;
        stack.length = idx;
        return extra + `</${t}>`;
      }
      return '';
    }
    stack.push(t);
    return match;
  }) + stack.reverse().map(t => `</${t}>`).join('');
}

// ---------------------------------------------------------------------------
// Telegram renderer
// ---------------------------------------------------------------------------

function telegramRenderer(): MarkedExtension {
  return {
    renderer: {
      // -- block --
      heading(token: Tokens.Heading) {
        return `<b>${this.parser.parseInline(token.tokens)}</b>\n\n`;
      },
      paragraph(token: Tokens.Paragraph) {
        return `${this.parser.parseInline(token.tokens)}\n\n`;
      },
      code(token: Tokens.Code) {
        const langAttr = token.lang ? ` class="language-${escapeHtml(token.lang)}"` : '';
        return `<pre><code${langAttr}>${escapeHtml(token.text)}</code></pre>\n\n`;
      },
      blockquote(token: Tokens.Blockquote) {
        const inner = this.parser.parse(token.tokens).replace(/\n+$/, '');
        // Telegram supports expandable blockquotes for long content
        if (inner.length > 500) {
          return `<blockquote expandable>${inner}</blockquote>\n\n`;
        }
        return `<blockquote>${inner}</blockquote>\n\n`;
      },
      list(token: Tokens.List) {
        const items = token.items
          .map((item, index) => {
            const prefix = token.ordered ? `${(token.start || 1) + index}. ` : '\u2022 ';
            const content = this.parser.parseInline(item.tokens).replace(/\n+$/, '');
            return `${prefix}${content}`;
          })
          .join('\n');
        return `${items}\n\n`;
      },
      hr() {
        return '\u2500\u2500\u2500\n\n';
      },
      table(token: Tokens.Table) {
        // Render tables as monospace pre blocks since Telegram has no table support
        const headers = token.header.map(h => this.parser.parseInline(h.tokens));
        const rows = token.rows.map(row => row.map(cell => this.parser.parseInline(cell.tokens)));

        // Strip HTML tags for the pre-formatted table (tags inside <pre> render literally)
        const strip = (s: string) => s.replace(/<[^>]+>/g, '');
        const plainHeaders = headers.map(strip);
        const plainRows = rows.map(r => r.map(strip));

        // Calculate column widths
        const colWidths = plainHeaders.map((h, i) => {
          const cellWidths = plainRows.map(r => (r[i] || '').length);
          return Math.max(h.length, ...cellWidths);
        });

        const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
        const headerLine = plainHeaders.map((h, i) => pad(h, colWidths[i])).join(' | ');
        const divider = colWidths.map(w => '\u2500'.repeat(w)).join('\u2500\u253c\u2500');
        const bodyLines = plainRows.map(r => r.map((c, i) => pad(c, colWidths[i])).join(' | '));

        return `<pre>${escapeHtml([headerLine, divider, ...bodyLines].join('\n'))}</pre>\n\n`;
      },

      // -- inline --
      strong(token: Tokens.Strong) {
        return `<b>${this.parser.parseInline(token.tokens)}</b>`;
      },
      em(token: Tokens.Em) {
        return `<i>${this.parser.parseInline(token.tokens)}</i>`;
      },
      codespan(token: Tokens.Codespan) {
        return `<code>${escapeHtml(token.text)}</code>`;
      },
      del(token: Tokens.Del) {
        return `<s>${this.parser.parseInline(token.tokens)}</s>`;
      },
      link(token: Tokens.Link) {
        return `<a href="${escapeHtml(token.href)}">${this.parser.parseInline(token.tokens)}</a>`;
      },
      image(token: Tokens.Image) {
        // Telegram can't render images inline in text; show as a link
        return `<a href="${escapeHtml(token.href)}">${escapeHtml(token.text || 'image')}</a>`;
      },
      br() {
        return '\n';
      },
      text(token: Tokens.Text | Tokens.Escape) {
        // Token may have nested tokens (e.g. inside list items)
        if ('tokens' in token && token.tokens) {
          return this.parser.parseInline(token.tokens);
        }
        return escapeHtml(token.text);
      },
      html(token: Tokens.HTML | Tokens.Tag) {
        // Pass through only Telegram-safe tags
        return sanitizeTelegramHtml(token.raw);
      },
      space() {
        return '';
      },
      def() {
        return '';
      },
    },
  };
}

// ---------------------------------------------------------------------------
// WhatsApp renderer
// ---------------------------------------------------------------------------

function whatsappRenderer(): MarkedExtension {
  return {
    renderer: {
      // -- block --
      heading(token: Tokens.Heading) {
        return `*${this.parser.parseInline(token.tokens)}*\n\n`;
      },
      paragraph(token: Tokens.Paragraph) {
        return `${this.parser.parseInline(token.tokens)}\n\n`;
      },
      code(token: Tokens.Code) {
        return '```\n' + token.text + '\n```\n\n';
      },
      blockquote(token: Tokens.Blockquote) {
        const inner = this.parser.parse(token.tokens).replace(/\n+$/, '');
        // Prefix each line with >
        return inner.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
      },
      list(token: Tokens.List) {
        const items = token.items
          .map((item, index) => {
            const prefix = token.ordered ? `${(token.start || 1) + index}. ` : '- ';
            const content = this.parser.parseInline(item.tokens).replace(/\n+$/, '');
            return `${prefix}${content}`;
          })
          .join('\n');
        return `${items}\n\n`;
      },
      hr() {
        return '---\n\n';
      },
      table(token: Tokens.Table) {
        // Render as monospace code block
        const strip = (s: string) => s.replace(/[*_~`]/g, '');
        const headers = token.header.map(h => strip(this.parser.parseInline(h.tokens)));
        const rows = token.rows.map(row => row.map(cell => strip(this.parser.parseInline(cell.tokens))));

        const colWidths = headers.map((h, i) => {
          const cellWidths = rows.map(r => (r[i] || '').length);
          return Math.max(h.length, ...cellWidths);
        });

        const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
        const headerLine = headers.map((h, i) => pad(h, colWidths[i])).join(' | ');
        const divider = colWidths.map(w => '-'.repeat(w)).join('-+-');
        const bodyLines = rows.map(r => r.map((c, i) => pad(c, colWidths[i])).join(' | '));

        return '```\n' + [headerLine, divider, ...bodyLines].join('\n') + '\n```\n\n';
      },

      // -- inline --
      strong(token: Tokens.Strong) {
        return `*${this.parser.parseInline(token.tokens)}*`;
      },
      em(token: Tokens.Em) {
        return `_${this.parser.parseInline(token.tokens)}_`;
      },
      codespan(token: Tokens.Codespan) {
        return `\`${token.text}\``;
      },
      del(token: Tokens.Del) {
        return `~${this.parser.parseInline(token.tokens)}~`;
      },
      link(token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        // WhatsApp auto-links URLs, so just show text + URL
        if (text === token.href) return token.href;
        return `${text} (${token.href})`;
      },
      image(token: Tokens.Image) {
        return `${token.text || 'image'} (${token.href})`;
      },
      br() {
        return '\n';
      },
      text(token: Tokens.Text | Tokens.Escape) {
        if ('tokens' in token && token.tokens) {
          return this.parser.parseInline(token.tokens);
        }
        return token.text;
      },
      html(token: Tokens.HTML | Tokens.Tag) {
        // Strip all HTML tags for WhatsApp
        return token.raw.replace(/<[^>]+>/g, '');
      },
      space() {
        return '';
      },
      def() {
        return '';
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Pre/post processing for Telegram-specific syntax (non-standard markdown)
// ---------------------------------------------------------------------------

/** Handle ||spoiler|| syntax before passing to marked (not standard markdown). */
function preSpoiler(text: string): string {
  // Protect from marked by converting to a placeholder
  return text.replace(/\|\|(.+?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const telegramInstance = new Marked();
telegramInstance.use(telegramRenderer());

const whatsappInstance = new Marked();
whatsappInstance.use(whatsappRenderer());

/** Convert markdown to Telegram-compatible HTML. */
export function markdownToTelegram(text: string): string {
  const preprocessed = preSpoiler(text);
  const html = telegramInstance.parse(preprocessed) as string;
  // Trim trailing whitespace and apply safety sanitization
  return sanitizeTelegramHtml(html.replace(/\n{3,}/g, '\n\n').trim());
}

/** Convert markdown to WhatsApp-compatible formatting. */
export function markdownToWhatsApp(text: string): string {
  const result = whatsappInstance.parse(text) as string;
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

// Re-export sanitizer for use in send.ts (Telegram edit fallback)
export { sanitizeTelegramHtml };
