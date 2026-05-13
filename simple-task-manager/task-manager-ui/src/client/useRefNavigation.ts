import { useState, useRef, useEffect, useCallback } from 'react';
import { isCollapsed, setCollapsed, toggleCollapsed } from './collapseState';
import { findTaskLocation } from './taskNavigation';
import type { Task } from '@/types/task';

type Tab = 'active' | 'done';
type PendingNav = { id: number; storageKey: string; scope: string } | null;

export function useRefNavigation(
  active: Task[],
  done: Task[],
  tab: Tab,
  setTab: (tab: Tab) => void,
  storageKeys: { active: string; done: string },
) {
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [collapseVersion, setCollapseVersion] = useState(0);
  const pendingNav = useRef<PendingNav>(null);
  const pendingScrollId = useRef<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scrollToTask(id: number) {
    const el = document.querySelector(`[data-task-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedId(id);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), 1500);
  }

  useEffect(() => {
    if (pendingNav.current !== null) {
      const { id, storageKey, scope } = pendingNav.current;
      pendingNav.current = null;
      if (isCollapsed(localStorage, storageKey, scope)) {
        setCollapsed(localStorage, storageKey, scope, false);
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
      const location = findTaskLocation(active, done, targetId);
      const targetTab: Tab = location?.tab ?? 'active';
      const storageKey = targetTab === 'done' ? storageKeys.done : storageKeys.active;
      const scope = location?.scope ?? '(no scope)';

      if (tab !== targetTab) {
        pendingNav.current = { id: targetId, storageKey, scope };
        setTab(targetTab);
      } else if (isCollapsed(localStorage, storageKey, scope)) {
        setCollapsed(localStorage, storageKey, scope, false);
        pendingScrollId.current = targetId;
        setCollapseVersion((v) => v + 1);
      } else {
        scrollToTask(targetId);
      }
    },
    [active, done, tab, setTab, storageKeys],
  );

  const toggleCollapse = useCallback((storageKey: string, scope: string) => {
    toggleCollapsed(localStorage, storageKey, scope);
    setCollapseVersion((v) => v + 1);
  }, []);

  return { navigateToRef, highlightedId, collapseVersion, toggleCollapse };
}
