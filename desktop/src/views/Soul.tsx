import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, User, Brain, Save, RotateCcw, Loader2 } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

const WORKSPACE_DIR = '~/.my-agent/workspace';

const FILES = [
  {
    name: 'SOUL.md',
    label: 'Soul',
    icon: Sparkles,
    description: 'personality, tone, behavior guidelines',
  },
  {
    name: 'USER.md',
    label: 'User',
    icon: User,
    description: 'who you are, preferences, context about you',
  },
  {
    name: 'MEMORY.md',
    label: 'Memory',
    icon: Brain,
    description: 'persistent facts the agent remembers across sessions',
  },
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
      // file doesn't exist yet
      setFiles(prev => ({
        ...prev,
        [name]: { content: '', original: '', loading: false, saving: false, error: null },
      }));
    }
  }, [gateway]);

  const saveFile = useCallback(async (name: string) => {
    const file = files[name];
    if (!file) return;

    setFiles(prev => ({
      ...prev,
      [name]: { ...prev[name], saving: true, error: null },
    }));

    try {
      await gateway.rpc('fs.write', { path: `${WORKSPACE_DIR}/${name}`, content: file.content });
      setFiles(prev => ({
        ...prev,
        [name]: { ...prev[name], original: prev[name].content, saving: false },
      }));
    } catch (err) {
      setFiles(prev => ({
        ...prev,
        [name]: { ...prev[name], saving: false, error: err instanceof Error ? err.message : 'save failed' },
      }));
    }
  }, [files, gateway]);

  const revert = useCallback((name: string) => {
    setFiles(prev => ({
      ...prev,
      [name]: { ...prev[name], content: prev[name].original, error: null },
    }));
  }, []);

  // load all files on connect
  useEffect(() => {
    if (disabled) return;
    for (const f of FILES) {
      loadFile(f.name);
    }
  }, [disabled, loadFile]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm">Soul</span>
        <span className="text-[10px] text-muted-foreground ml-1">~/.my-agent/workspace/</span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4 max-w-2xl">
          <div className="text-[11px] text-muted-foreground">
            these files shape the agent's personality, knowledge about you, and persistent memory.
            changes take effect on the next agent run.
          </div>

          {FILES.map(({ name, label, icon: Icon, description }) => {
            const file = files[name];
            const isDirty = file && file.content !== file.original;

            return (
              <Card key={name}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold">{label}</span>
                    <span className="text-[10px] text-muted-foreground">{name}</span>
                    {isDirty && (
                      <span className="text-[9px] text-warning ml-auto">unsaved</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mb-3">{description}</div>

                  {file?.loading ? (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-4">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      loading...
                    </div>
                  ) : (
                    <>
                      <Textarea
                        value={file?.content || ''}
                        onChange={e => setFiles(prev => ({
                          ...prev,
                          [name]: { ...prev[name], content: e.target.value, error: null },
                        }))}
                        placeholder={`write your ${label.toLowerCase()} here...`}
                        className="font-mono text-[11px] min-h-[120px] resize-y bg-background"
                        disabled={disabled}
                      />

                      {file?.error && (
                        <div className="text-[10px] text-destructive mt-1">{file.error}</div>
                      )}

                      <div className="flex gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] px-3"
                          onClick={() => saveFile(name)}
                          disabled={disabled || !isDirty || file?.saving}
                        >
                          {file?.saving ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Save className="w-3 h-3 mr-1" />
                          )}
                          save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] px-3"
                          onClick={() => revert(name)}
                          disabled={disabled || !isDirty}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          revert
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <div className="text-[10px] text-muted-foreground px-1">
            the agent reads these files into its system prompt every session.
            soul defines personality, user defines who you are, memory stores facts across conversations.
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
