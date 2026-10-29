// Copy-paste setup for a client machine. The key goes straight into the
// local-scope entry, which Claude Code keeps in the user's ~/.claude.json, never
// in the repo's .mcp.json. Single quotes work in bash/zsh and PowerShell alike;
// neither the URL nor a stm_ key (base64url) needs escaping beyond that.

export function mcpUrlFor(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/mcp`;
}

function quote(s: string): string {
  return `'${s.replace(/'/g, '')}'`;
}

export function addLine({ key, url }: { key: string; url: string }): string {
  return `claude mcp add --transport http task-manager ${quote(url)} --header ${quote(`Authorization: Bearer ${key}`)} --scope local`;
}

// A prompt the user pastes into Claude Code in the repo, so an agent runs the
// setup. It carries the key, so it is as secret as the key itself.
export function setupPrompt({ key, url, project }: { key: string; url: string; project: string }): string {
  return [
    'Connect this repo to my simple-task-manager server over HTTP (client mode).',
    '',
    `Server: ${url}`,
    `Default project: ${project} (other projects stay reachable by passing \`project\` to the tools)`,
    '',
    '1. If this repo already has a task-manager MCP entry, remove it first:',
    '',
    '   claude mcp remove task-manager -s local',
    '',
    '2. Run this from the repo root. It stores the entry in my user config (~/.claude.json),',
    '   not in the repo, so nothing secret gets committed. Do not add the key to .mcp.json.',
    '',
    `   ${addLine({ key, url })}`,
    '',
    '3. Tell me to restart Claude Code in this repo, then run the task-manager `health` tool.',
    `   It should report Transport = http and project ${project}. A 401 means the key was revoked.`,
  ].join('\n');
}
