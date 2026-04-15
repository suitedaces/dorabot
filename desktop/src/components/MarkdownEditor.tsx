import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Link } from '@tiptap/extension-link';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Image } from '@tiptap/extension-image';
import { Markdown as TiptapMarkdown } from 'tiptap-markdown';
import { useEffect, useCallback, useRef } from 'react';

type Props = {
  content: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMarkdownFromEditor(editor: any): string {
  try {
    return editor.storage.markdown.getMarkdown() as string;
  } catch {
    return editor.getText();
  }
}

export function MarkdownEditor({ content, onChange, editable = true, placeholder, className, autoFocus }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'tiptap-code-block' } },
        code: { HTMLAttributes: { class: 'tiptap-code-inline' } },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Link.configure({ openOnClick: true, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Placeholder.configure({ placeholder: placeholder || 'Start writing...' }),
      TiptapMarkdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap-editor outline-none',
      },
    },
    onUpdate: ({ editor: e }) => {
      onChangeRef.current?.(getMarkdownFromEditor(e));
    },
  });

  // sync editable
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // sync content from outside (only when not focused/editing)
  const syncContent = useCallback((md: string) => {
    if (!editor || editor.isFocused) return;
    const current = getMarkdownFromEditor(editor);
    if (current !== md) {
      editor.commands.setContent(md);
    }
  }, [editor]);

  useEffect(() => {
    syncContent(content);
  }, [content, syncContent]);

  // auto-focus
  useEffect(() => {
    if (autoFocus && editor && editable) {
      setTimeout(() => editor.commands.focus('end'), 50);
    }
  }, [autoFocus, editor, editable]);

  if (!editor) return null;

  return (
    <div className={className}>
      <EditorContent editor={editor} />
    </div>
  );
}
