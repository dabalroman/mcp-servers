import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dropLabel, groupBySeq, reorderAfterDrop, type DropTarget, type ReorderOrder, type SeqGroup } from '@/lib/taskView';
import type { Task } from '@/types/task';

// Tree rail: each child draws its own segment (bridging the gap-2 above it) plus a
// tick to its title row; the last segment stops at its tick.
const EPIC_RAIL = 'relative ml-2 pl-5 before:absolute before:left-0 before:-top-2 before:bottom-0 before:border-l before:border-primary/40 after:absolute after:left-0 after:top-6 after:w-5 after:border-t after:border-primary/40 last:before:bottom-auto last:before:h-8';

const GRABBING_CLASS = 'dnd-grabbing';

const targetId = (t: DropTarget) => (t.kind === 'join' ? `join:${t.group}` : `gap:${t.before}`);

// A gap strip overlaps the card edge below it, so the pointer there means "new step", not "join".
// The keyboard sensor has no pointer: it takes the droppable closest to the moved ghost.
const collision: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args).slice(0, 1);
  const hits = pointerWithin(args);
  return [hits.find((h) => String(h.id).startsWith('gap:')) ?? hits[0]].filter((h) => h !== undefined);
};

type Props = {
  epicId: number;
  kids: Task[];
  renderCard: (child: Task, dragHandle?: ReactNode) => ReactNode;
  // Resolves false when the reorder failed (the caller shows the toast).
  onReorder: (epicId: number, order: ReorderOrder) => Promise<boolean>;
};

// An epic's children on the tree rail, grouped per step. Children drag by their handle, only within
// this epic: drop on a step to join it, in a gap between steps for a new step. Cards never move
// during a drag; the order changes once the refetched list arrives.
export function EpicChildren({ epicId, kids, renderCard, onReorder }: Props) {
  const groups = groupBySeq(kids);
  const draggable = kids.length >= 2;
  const [activeId, setActiveId] = useState<number | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  // The refetched list carries the new seq values; until then the dropped card stays dimmed.
  const seqSignature = kids.map((k) => `${k.id}:${k.seq ?? ''}`).join(',');
  useEffect(() => { setPendingId(null); }, [seqSignature]);

  useEffect(() => () => document.documentElement.classList.remove(GRABBING_CLASS), []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // The target only when dropping there changes the order; no-op targets get no indicator.
  const changingTarget = (draggedId: number | null, t: DropTarget | null | undefined) =>
    draggedId !== null && t && reorderAfterDrop(groups, draggedId, t) ? t : null;
  const effectiveTarget = changingTarget(activeId, target);
  const describe = (t: DropTarget | null) => (t ? dropLabel(groups, t) : 'No change');
  const overTarget = (over: { data: { current?: unknown } } | null) => over?.data.current as DropTarget | undefined;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up #${active.id}.`,
    onDragOver: ({ active, over }) => `#${active.id}: ${describe(changingTarget(Number(active.id), overTarget(over)))}.`,
    onDragEnd: ({ active, over }) => {
      const t = changingTarget(Number(active.id), overTarget(over));
      return t ? `Dropped #${active.id}: ${dropLabel(groups, t)}.` : `#${active.id} not moved.`;
    },
    onDragCancel: ({ active }) => `Reorder of #${active.id} cancelled.`,
  };

  function endDrag() {
    setActiveId(null);
    setTarget(null);
    document.documentElement.classList.remove(GRABBING_CLASS);
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(Number(e.active.id));
    document.documentElement.classList.add(GRABBING_CLASS);
  }

  function handleDragOver(e: DragOverEvent) {
    setTarget(overTarget(e.over) ?? null);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const draggedId = Number(e.active.id);
    const t = overTarget(e.over);
    endDrag();
    const order = t ? reorderAfterDrop(groups, draggedId, t) : null;
    if (!order) return;
    setPendingId(draggedId);
    if (!(await onReorder(epicId, order))) setPendingId(null);
  }

  const active = activeId === null ? undefined : kids.find((k) => k.id === activeId);
  const hasNoStepGroup = groups[groups.length - 1]?.step === undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      // Portaled: inline, the live region would become the rail's `last:` child.
      accessibility={{ announcements, container: document.body }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={(e) => void handleDragEnd(e)}
      onDragCancel={endDrag}
    >
      {groups.flatMap((group, g) => group.tasks.map((child, i) => (
        <ChildRow
          key={child.id}
          child={child}
          group={group}
          groupIndex={g}
          first={i === 0}
          gapAfter={draggable && !hasNoStepGroup && g === groups.length - 1 && i === group.tasks.length - 1 ? groups.length : undefined}
          draggable={draggable}
          dimmed={child.id === activeId || child.id === pendingId}
          joinHighlight={effectiveTarget?.kind === 'join' && effectiveTarget.group === g}
          lineAbove={effectiveTarget?.kind === 'gap' && effectiveTarget.before === g && i === 0}
          lineBelow={effectiveTarget?.kind === 'gap' && effectiveTarget.before === groups.length}
          renderCard={renderCard}
        />
      )))}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="flex flex-col gap-2 max-w-sm border border-primary bg-card px-3 py-2 shadow-[0_8px_24px_hsl(var(--background)/0.8)]">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-xs tracking-widest text-primary shrink-0">#{active.id}</span>
                <span className="text-sm text-foreground truncate">{active.title}</span>
              </div>
              <span
                className={cn(
                  'self-start text-2xs tracking-widest uppercase border px-2 py-0.5',
                  effectiveTarget ? 'border-primary/60 text-primary' : 'border-border text-muted-foreground',
                )}
              >
                {describe(effectiveTarget)}
              </span>
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

type RowProps = {
  child: Task;
  group: SeqGroup;
  groupIndex: number;
  first: boolean;
  gapAfter?: number;
  draggable: boolean;
  dimmed: boolean;
  joinHighlight: boolean;
  lineAbove: boolean;
  lineBelow: boolean;
  renderCard: Props['renderCard'];
};

function ChildRow({ child, group, groupIndex, first, gapAfter, draggable, dimmed, joinHighlight, lineAbove, lineBelow, renderCard }: RowProps) {
  const join: DropTarget = { kind: 'join', group: groupIndex };
  const { setNodeRef: setJoinRef } = useDroppable({ id: `${targetId(join)}:${child.id}`, data: join, disabled: !draggable });
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef } = useDraggable({ id: child.id, disabled: !draggable });

  const handle = draggable ? (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...listeners}
      {...attributes}
      aria-label={`Reorder #${child.id}`}
      title="Drag to reorder"
      className="inline-flex items-center justify-center -m-3.5 p-3.5 sm:m-0 sm:p-1 text-muted-foreground/60 hover:bg-accent/30 hover:text-foreground focus-visible:bg-accent/30 focus-visible:text-foreground cursor-grab touch-none [-webkit-user-select:none] select-none transition-colors shrink-0"
    >
      <GripVertical className="w-4 h-4" strokeWidth={1.5} />
    </button>
  ) : undefined;

  const badgeTitle = group.step === undefined
    ? 'No step: runs after the numbered steps'
    : `Step ${group.step} of ${group.total}${group.tasks.length > 1 ? `, ${group.tasks.length} tasks run in parallel` : ''}`;

  return (
    <div ref={setDragRef} className={EPIC_RAIL}>
      {first && (
        <span
          title={badgeTitle}
          className={cn(
            'absolute left-0 top-3.5 z-[1] -translate-x-1/2 flex items-center justify-center w-6 h-6 border bg-background text-xs tabular-nums transition-colors',
            joinHighlight ? 'border-primary text-primary' : 'border-border text-muted-foreground',
          )}
        >
          {group.step ?? '–'}
        </span>
      )}
      {draggable && first && <GapZone before={groupIndex} edge="top" active={lineAbove} />}
      {gapAfter !== undefined && <GapZone before={gapAfter} edge="bottom" active={lineBelow} />}
      <div
        ref={setJoinRef}
        className={cn(
          'transition-opacity',
          dimmed && 'opacity-40',
          joinHighlight && 'outline outline-1 outline-primary outline-offset-2',
        )}
      >
        {renderCard(child, handle)}
      </div>
    </div>
  );
}

// A strip straddling the gap-2 between steps (absolute, so it adds no height). Its line is drawn
// at the middle of the gap, from the rail across the card width, with a square on the rail.
function GapZone({ before, edge, active }: { before: number; edge: 'top' | 'bottom'; active: boolean }) {
  const t: DropTarget = { kind: 'gap', before };
  const { setNodeRef } = useDroppable({ id: targetId(t), data: t });
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      className={cn('absolute left-0 right-0 h-4 z-[2] pointer-events-none', edge === 'top' ? '-top-3' : '-bottom-3')}
    >
      {active && (
        <>
          <span className="absolute left-0 right-0 top-2 h-0.5 -translate-y-1/2 bg-primary" />
          <span className="absolute left-0 top-2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 bg-primary" />
        </>
      )}
    </div>
  );
}
