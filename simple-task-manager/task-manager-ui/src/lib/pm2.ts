// Mirrors pm2AppName() in mcpConfig.ts, which the browser bundle can't import:
// the standalone UI's pm2 name follows its port, not the repo.
export function pm2AppName(port: string = window.location.port): string {
  return !port || port === '7374' ? 'task-manager' : `task-manager-${port}`;
}
