import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';

type Props = {
  onCreate: (title: string, description?: string) => void;
  busy?: boolean;
};

export function GoalCreationTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
      onClick={onClick}
      title="Add goal"
    >
      <Plus className="h-3 w-3" />
    </button>
  );
}

export function GoalCreationForm({ onCreate, busy, onClose }: Props & { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [showDesc, setShowDesc] = useState(false);

  const reset = () => { setTitle(''); setDescription(''); setShowDesc(false); };

  const handleCreate = () => {
    const t = title.trim();
    if (!t) return;
    onCreate(t, description.trim() || undefined);
    reset();
    onClose();
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <Input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleCreate();
          if (e.key === 'Escape') { reset(); onClose(); }
        }}
        placeholder="goal title"
        className="h-8 text-sm"
        autoFocus
      />
      {showDesc ? (
        <Input
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleCreate();
            if (e.key === 'Escape') { reset(); onClose(); }
          }}
          placeholder="why this matters"
          className="h-8 text-xs"
        />
      ) : (
        <button
          type="button"
          className="text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setShowDesc(true)}
        >
          + add description
        </button>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={handleCreate} disabled={!title.trim() || busy}>
          Create
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => { reset(); onClose(); }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
