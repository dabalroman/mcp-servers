type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function getCollapseMap(storage: StorageLike, storageKey: string): Record<string, boolean> {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

export function setCollapsed(
  storage: StorageLike,
  storageKey: string,
  key: string,
  collapsed: boolean,
): void {
  const map = getCollapseMap(storage, storageKey);
  map[key] = collapsed;
  storage.setItem(storageKey, JSON.stringify(map));
}

export function isCollapsed(storage: StorageLike, storageKey: string, key: string): boolean {
  const map = getCollapseMap(storage, storageKey);
  return map[key] ?? false;
}

export function toggleCollapsed(storage: StorageLike, storageKey: string, key: string): boolean {
  const next = !isCollapsed(storage, storageKey, key);
  setCollapsed(storage, storageKey, key, next);
  return next;
}
