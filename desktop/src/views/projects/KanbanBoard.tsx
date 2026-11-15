import { useMemo, useState } from 'react';
import { DndContext, type DragEndEvent, type DragStartEvent, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CircleDot, Timer, Eye, CheckCircle2,
  Plus, Target, MoreHorizontal, ChevronDown,
  Pause, Play, Check, Trash2, Ban, AlertTriangle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import type { TaskRun } from '../../hooks/useGateway';
import type { Task, Project, TaskStatus } from './helpers';
import { KanbanColumn } from './KanbanColumn';

export type ColumnId = 'todo' | 'in_progress' | 'review' | 'done';

type ColumnDef = {
  id: ColumnId;
  title: string;
  icon: LucideIcon;
  iconColor: string;
};

const COLUMNS: ColumnDef[] = [
  { id: 'todo', title: 'Todo', icon: CircleDot, iconColor: 'text-muted-foreground' },
  { id: 'in_progress', title: 'In Progress', icon: Timer, iconColor: 'text-amber-500' },
  { id: 'review', title: 'Review', icon: Eye, iconColor: 'text-orange-500' },
  { id: 'done', title: 'Done', icon: CheckCircle2, iconColor: 'text-emerald-500' },
];

const COLUMN_TO_STATUS: Record<ColumnId, TaskStatus> = {
  todo: 'todo',
  in_progress: 'in_progress',
  review: 'review',
  done: 'done',
};

const VALID_COLUMNS = new Set<string>(COLUMNS.map(c => c.id));

export function getColumnForTask(task: Task, taskRuns: Record<string, TaskRun>): ColumnId {
  const running = taskRuns[task.id]?.status === 'started';
  if (running || task.status === 'in_progress') return 'in_progress';
  if (task.status === 'review') return 'review';
  if (task.status === 'done') return 'done';
  return 'todo';
}

type Props = {
  tasks: Task[];
  projects: Project[];
  taskRuns: Record<string, TaskRun>;
  onTaskClick: (task: Task) => void;
  onCreateTask: (title: string, goalId?: string, status?: string) => void;
  onMoveTask: (taskId: string, toColumn: ColumnId, newGoalId?: string) => void;
  onCreateProject: (title: string, description?: string) => void;
  onToggleProjectStatus: (project: Project) => void;
  onCompleteProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  busy?: string | null;
};

function ProjectHeader({
  project,
  taskCount,
  doneCount,
  blockedCount,
  onToggleProjectStatus,
  onCompleteProject,
  onDeleteProject,
}: {
  project: Project | null;
  taskCount: number;
  doneCount: number;
  blockedCount: number;
  onToggleProjectStatus?: (project: Project) => void;
  onCompleteProject?: (project: Project) => void;
  onDeleteProject?: (projectId: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30">
      <Target className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-[13px] font-medium">
          {project ? project.title : 'Unassigned'}
        </span>
        {project?.description && (
          <span className="text-[11px] text-muted-foreground/50 ml-2">
            {project.description}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground/40">
        {blockedCount > 0 && (
          <span className="flex items-center gap-0.5 text-destructive/50">
            <AlertTriangle className="h-2.5 w-2.5" />
            {blockedCount}
          </span>
        )}
        <span>{doneCount}/{taskCount}</span>
      </div>

      {project && onToggleProjectStatus && onCompleteProject && onDeleteProject && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/50 transition-colors shrink-0">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onToggleProjectStatus(project)}>
              {project.status === 'paused' ? (
                <><Play className="mr-2 h-3.5 w-3.5" /> Resume</>
              ) : (
                <><Pause className="mr-2 h-3.5 w-3.5" /> Pause</>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCompleteProject(project)}>
              <Check className="mr-2 h-3.5 w-3.5" /> Complete
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => onDeleteProject(project.id)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {project?.status === 'paused' && (
        <span className="text-[9px] text-amber-500/70 font-medium uppercase">paused</span>
      )}
    </div>
  );
}

export function KanbanBoard({
  tasks, projects, taskRuns,
  onTaskClick, onCreateTask, onMoveTask, onCreateProject,
  onToggleProjectStatus, onCompleteProject, onDeleteProject,
  busy,
}: Props) {
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const activeProjects = useMemo(
    () => projects.filter(p => p.status !== 'done').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [projects],
  );

  const doneProjects = useMemo(
    () => projects.filter(p => p.status === 'done'),
    [projects],
  );

  const tasksByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    const orphan: Task[] = [];
    for (const p of projects) map.set(p.id, []);
    for (const t of tasks) {
      if (t.goalId && map.has(t.goalId)) {
        map.get(t.goalId)!.push(t);
      } else {
        orphan.push(t);
      }
    }
    return { map, orphan };
  }, [tasks, projects]);

  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasksById.get(event.active.id as string);
    setActiveTask(task || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const overId = over.id as string;
    const sepIdx = overId.indexOf(':');
    if (sepIdx === -1) return;
    const targetProjectId = overId.slice(0, sepIdx) || undefined;
    const targetColumn = overId.slice(sepIdx + 1);
    if (!VALID_COLUMNS.has(targetColumn)) return;

    const taskId = active.id as string;
    const task = tasksById.get(taskId);
    if (!task) return;

    const currentColumn = getColumnForTask(task, taskRuns);
    const projectChanged = (task.goalId || '') !== (targetProjectId || '');
    if (currentColumn === targetColumn && !projectChanged) return;

    onMoveTask(taskId, targetColumn as ColumnId, targetProjectId);
  };

  const handleCreateProject = () => {
    const t = newProjectTitle.trim();
    if (!t) return;
    onCreateProject(t);
    setNewProjectTitle('');
    setShowProjectForm(false);
  };

  const handleCreateInColumn = (title: string, columnId: ColumnId, projectId?: string) => {
    onCreateTask(title, projectId, COLUMN_TO_STATUS[columnId]);
  };

  const renderProjectBoard = (project: Project | null, projectTasks: Task[]) => {
    const tasksByColumn = new Map<ColumnId, Task[]>();
    for (const col of COLUMNS) tasksByColumn.set(col.id, []);
    for (const task of projectTasks) {
      const col = getColumnForTask(task, taskRuns);
      tasksByColumn.get(col)?.push(task);
    }
    for (const [, arr] of tasksByColumn) {
      arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    const blockedCount = projectTasks.filter(t => t.status === 'blocked').length;
    const doneCount = projectTasks.filter(t => t.status === 'done').length;
    const droppablePrefix = project?.id || '';

    return (
      <div key={project?.id || '__orphan'} className="rounded-lg border border-border/40 bg-card/30">
        <ProjectHeader
          project={project}
          taskCount={projectTasks.length}
          doneCount={doneCount}
          blockedCount={blockedCount}
          onToggleProjectStatus={project ? onToggleProjectStatus : undefined}
          onCompleteProject={project ? onCompleteProject : undefined}
          onDeleteProject={project ? onDeleteProject : undefined}
        />
        <div className="flex overflow-x-auto p-1.5 gap-0">
          {COLUMNS.map(col => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              droppableId={`${droppablePrefix}:${col.id}`}
              title={col.title}
              icon={col.icon}
              iconColor={col.iconColor}
              tasks={tasksByColumn.get(col.id) || []}
              onTaskClick={onTaskClick}
              onCreateTask={(title) => handleCreateInColumn(title, col.id, project?.id)}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full overflow-y-auto">
        <div className="space-y-3 p-4">
          {/* header */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Projects
            </span>
            <button
              type="button"
              className="h-4 w-4 flex items-center justify-center rounded text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
              onClick={() => setShowProjectForm(v => !v)}
              title="New project"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          </div>

          {/* new project form */}
          {showProjectForm && (
            <div className="flex items-center gap-2">
              <Input
                value={newProjectTitle}
                onChange={e => setNewProjectTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateProject();
                  if (e.key === 'Escape') { setShowProjectForm(false); setNewProjectTitle(''); }
                }}
                placeholder="Project name..."
                className="h-7 text-xs max-w-xs"
                autoFocus
              />
              <Button size="sm" className="h-7 text-xs" onClick={handleCreateProject} disabled={!newProjectTitle.trim()}>
                Create
              </Button>
            </div>
          )}

          {/* active project boards */}
          {activeProjects.map(project => renderProjectBoard(project, tasksByProject.map.get(project.id) || []))}

          {/* orphan tasks */}
          {tasksByProject.orphan.length > 0 && renderProjectBoard(null, tasksByProject.orphan)}

          {/* completed projects */}
          {doneProjects.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/30 hover:text-muted-foreground/50 transition-colors"
                onClick={() => setShowArchive(v => !v)}
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', !showArchive && '-rotate-90')} />
                Completed ({doneProjects.length})
              </button>
              {showArchive && (
                <div className="mt-1.5 space-y-1">
                  {doneProjects.map(project => (
                    <div key={project.id} className="rounded-md px-3 py-1.5 flex items-center gap-2 text-muted-foreground/40">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500/30" />
                      <span className="text-[11px]">{project.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* drag overlay */}
      <DragOverlay>
        {activeTask && (
          <div className="rounded-md bg-card border border-border/50 px-2 py-1.5 shadow-lg opacity-90 max-w-[200px]">
            <div className="text-[12px] leading-snug truncate">{activeTask.title}</div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
