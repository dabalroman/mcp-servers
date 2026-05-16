import { useState, useRef, useEffect, useCallback } from 'react';
import { isCollapsed, setCollapsed, toggleCollapsed } from './collapseState';
import { findTaskLocation } from './taskNavigation';
import type { Task } from '@/types/task';
import type { GroupBy } from '@/lib/taskView';

type Tab = 'active' | 'done';
type PendingNav = { id: number; sectionKey: string } | null;

const COLLAPSE_STORAGE_KEY = 'task-manager:collapse';

export function useRefNavigation(
  active: Task[],
  done: Task[],
  tab: Tab,
  setTab: (tab: Tab) => void,
  groupBy: GroupBy,
) {
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [collapseVersion, setCollapseVersion] = useState(0);
  const pendingNav = useRef<PendingNav>(null);
  const pendingScrollId = useRef<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function sectionKey(sectionValue: string): string {
    return `${groupBy}:${sectionValue}`;
  }

  function scrollToTask(id: number) {
    const el = document.querySelector(`[data-task-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedId(id);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), 1500);
  }

  useEffect(() => {
    if (pendingNav.current !== null) {
      const { id, sectionKey: key } = pendingNav.current;
      pendingNav.current = null;
      if (isCollapsed(localStorage, COLLAPSE_STORAGE_KEY, key)) {
        setCollapsed(localStorage, COLLAPSE_STORAGE_KEY, key, false);
        pendingScrollId.current = id;
        setCollapseVersion((v) => v + 1);
      } else {
        scrollToTask(id);
      }
    }
  }, [tab]);

  useEffect(() => {
    if (pendingScrollId.current !== null) {
      const id = pendingScrollId.current;
      pendingScrollId.current = null;
      scrollToTask(id);
    }
  }, [collapseVersion]);

  const navigateToRef = useCallback(
    (targetId: number) => {
      const location = findTaskLocation(active, done, targetId, groupBy);
      const targetTab: Tab = location?.tab ?? 'active';
      const key = sectionKey(location?.sectionValue ?? '');

      if (tab !== targetTab) {
        pendingNav.current = { id: targetId, sectionKey: key };
        setTab(targetTab);
      } else if (isCollapsed(localStorage, COLLAPSE_STORAGE_KEY, key)) {
        setCollapsed(localStorage, COLLAPSE_STORAGE_KEY, key, false);
        pendingScrollId.current = targetId;
        setCollapseVersion((v) => v + 1);
      } else {
        scrollToTask(targetId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, done, tab, setTab, groupBy],
  );

  const toggleCollapse = useCallback((key: string) => {
    toggleCollapsed(localStorage, COLLAPSE_STORAGE_KEY, key);
    setCollapseVersion((v) => v + 1);
  }, []);

  return { navigateToRef, highlightedId, collapseVersion, toggleCollapse };
}
