import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Sparkles, User, Brain, Bot, Save, RotateCcw, Loader2, Pencil, Eye } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

const WORKSPACE_DIR = '~/.dorabot/workspace';

const FILES = [
  { name: 'SOUL.md', label: 'Soul', icon: Sparkles, description: 'personality, tone, behavior guidelines' },
  { name: 'USER.md', label: 'User', icon: User, description: 'who you are, preferences, context about you' },
  { name: 'MEMORY.md', label: 'Memory', icon: Brain, description: 'persistent facts across sessions' },
  { name: 'AGENTS.md', label: 'Agents', icon: Bot, description: 'agent-specific instructions and rules' },
] as const;

type FileState = {
  content: string;
  original: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

export function SoulView({ gateway }: Props) {
  const disabled = gateway.connectionState !== 'connected';
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [activeFile, setActiveFile] = useState(FILES[0].name);
  const [editing, setEditing] = useState(false);

  const loadFile = useCallback(async (name: string) => {
    setFiles(prev => ({
      ...prev,
      [name]: { content: '', original: '', loading: true, saving: false, error: null },
    }));
    try {
      const res = await gateway.rpc('fs.read', { path: `${WORKSPACE_DIR}/${name}` }) as { content: string };
      const content = res?.content || '';
      setFiles(prev => ({
        ...prev,
        [name]: { content, original: content, loading: false, saving: false, error: null },
      }));
    } catch {
      setFiles(prev => ({
        ...prev,
        [name]: { content: '', original: '', loading: false, saving: false, error: null },
      }));
    }
  }, [gateway]);

  const saveFile = useCallback(async (name: string) => {
    const file = files[name];
    if (!file) return;
    setFiles(prev => ({ ...prev, [name]: { ...prev[name], saving: true, error: null } }));
    try {
      await gateway.rpc('fs.write', { path: `${WORKSPACE_DIR}/${name}`, content: file.content });
      setFiles(prev => ({ ...prev, [name]: { ...prev[name], original: prev[name].content, saving: false } }));
    } catch (err) {
      setFiles(prev => ({
        ...prev,
        [name]: { ...prev[name], saving: false, error: err instanceof Error ? err.message : 'save failed' },
      }));
    }
  }, [files, gateway]);

  const revert = useCallback((name: string) => {
    setFiles(prev => ({ ...prev, [name]: { ...prev[name], content: prev[name].original, error: null } }));
  }, []);

  useEffect(() => {
    if (disabled) return;
    for (const f of FILES) loadFile(f.name);
  }, [disabled, loadFile]);

  const file = files[activeFile];
  const isDirty = file && file.content !== file.original;
  const fileMeta = FILES.find(f => f.name === activeFile)!;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm">Soul</span>
        <span className="text-[10px] text-muted-foreground ml-1">~/.dorabot/workspace/</span>
      </div>

      {/* file tabs */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
        {FILES.map(({ name, label, icon: Icon }) => {
          const f = files[name];
          const dirty = f && f.content !== f.original;
          return (
            <button
              key={name}
              onClick={() => { setActiveFile(name); setEditing(false); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors ${
                activeFile === name
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
              {dirty && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={editing ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => setEditing(!editing)}
            disabled={disabled}
          >
            {editing ? <Eye className="w-3 h-3 mr-1" /> : <Pencil className="w-3 h-3 mr-1" />}
            {editing ? 'preview' : 'edit'}
          </Button>
          {editing && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => saveFile(activeFile)}
                disabled={disabled || !isDirty || file?.saving}
              >
                {file?.saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => revert(activeFile)}
                disabled={disabled || !isDirty}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                revert
              </Button>
            </>
          )}
        </div>
      </div>

      {/* description */}
      <div className="px-4 py-1.5 text-[10px] text-muted-foreground border-b border-border shrink-0">
        {fileMeta.description}
        {isDirty && <span className="text-warning ml-2">· unsaved changes</span>}
        {file?.error && <span className="text-destructive ml-2">· {file.error}</span>}
      </div>

      {/* content */}
      <div className="flex-1 min-h-0">
        {file?.loading ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground p-4">
            <Loader2 className="w-3 h-3 animate-spin" />
            loading...
          </div>
        ) : editing ? (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={50} minSize={30}>
              <Textarea
                value={file?.content || ''}
                onChange={e => setFiles(prev => ({
                  ...prev,
                  [activeFile]: { ...prev[activeFile], content: e.target.value, error: null },
                }))}
                placeholder={`write your ${fileMeta.label.toLowerCase()} here...`}
                className="w-full h-full font-mono text-[11px] text-foreground rounded-none border-0 resize-none focus-visible:ring-0 focus-visible:border-0 p-4"
                disabled={disabled}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={50} minSize={20}>
              <ScrollArea className="h-full">
                <div className="markdown-viewer p-4 text-[12px]">
                  <ReactMarkdown>{file?.content || ''}</ReactMarkdown>
                </div>
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <ScrollArea className="h-full">
            <div className="markdown-viewer p-4 text-[12px]">
              <ReactMarkdown>{file?.content || '*empty — click edit to add content*'}</ReactMarkdown>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
