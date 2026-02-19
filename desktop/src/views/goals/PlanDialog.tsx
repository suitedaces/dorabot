import { useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Eye, PenSquare, Save, FileText } from 'lucide-react';
import type { Task } from './helpers';
import type { useGateway } from '../../hooks/useGateway';
import { toast } from 'sonner';

type Props = {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateway: ReturnType<typeof useGateway>;
  onSaved?: () => void;
};

export function PlanDialog({ task, open, onOpenChange, gateway, onSaved }: Props) {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPlan = useCallback(async (t: Task) => {
    setMode('preview');
    setLoading(true);
    setPath(t.planDocPath || 'PLAN.md');
    try {
      const res = await gateway.rpc('tasks.plan.read', { id: t.id }) as { path?: string; content?: string } | null;
      const c = res?.content || t.plan || '';
      setContent(c);
      setDraft(c);
      setPath(res?.path || t.planDocPath || 'PLAN.md');
    } catch {
      const fallback = t.plan || '';
      setContent(fallback);
      setDraft(fallback);
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  const savePlan = useCallback(async () => {
    if (!task) return;
    setSaving(true);
    try {
      const res = await gateway.rpc('tasks.plan.write', { id: task.id, content: draft }) as { path?: string; content?: string } | null;
      setContent(res?.content || draft);
      setDraft(res?.content || draft);
      setPath(res?.path || path);
      setMode('preview');
      onSaved?.();
      toast.success('plan saved');
    } catch {
      toast.error('failed to save plan');
    } finally {
      setSaving(false);
    }
  }, [gateway, task, draft, path, onSaved]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && task) {
      void loadPlan(task);
    }
    onOpenChange(nextOpen);
  }, [task, loadPlan, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="h-[85vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {task?.title || 'Task Plan'}
          </DialogTitle>
          <div className="text-[10px] text-muted-foreground">{path || 'PLAN.md'}</div>
        </DialogHeader>

        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <div className="text-[10px] text-muted-foreground">
            {loading ? 'loading...' : mode === 'edit' ? 'editing' : 'preview'}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={mode === 'preview' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setMode('preview')}
              disabled={loading}
            >
              <Eye className="mr-1.5 h-3 w-3" />
              Preview
            </Button>
            <Button
              variant={mode === 'edit' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setMode('edit')}
              disabled={loading}
            >
              <PenSquare className="mr-1.5 h-3 w-3" />
              Edit
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => void savePlan()}
              disabled={loading || saving || mode !== 'edit'}
            >
              {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Save className="mr-1.5 h-3 w-3" />}
              Save
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              loading plan...
            </div>
          ) : mode === 'preview' ? (
            <div className="markdown-viewer p-6 text-sm">
              <Markdown remarkPlugins={[remarkGfm]}>{content || '_no plan yet_'}</Markdown>
            </div>
          ) : (
            <div className="h-full p-6">
              <Textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                className="h-full min-h-[60vh] font-mono text-sm"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
