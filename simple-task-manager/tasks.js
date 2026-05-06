import { readFileSync, writeFileSync, renameSync } from 'fs';

const PRIORITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_ORDER = { in_progress: 2, todo: 1, done: 0 };

/**
 * Parse the tasks markdown file.
 * Throws a descriptive error if the file is structurally corrupted.
 * Logs a warning to stderr for individual malformed tasks (skips them).
 *
 * @param {string} filePath
 * @returns {{ counter: number, tasks: Task[] }}
 */
export function parseTasks(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { counter: 0, tasks: [] };
    }
    throw new Error(
      `FILE IS CORRUPTED: Cannot read tasks file at "${filePath}" — ${err.message}. ` +
      `Stop any action and wait for instructions.`
    );
  }

  const lines = content.split('\n');
  let counter = 0;

  // Extract counter from first # Counter: line
  const counterLine = lines.find(l => /^# Counter:\s*\d+/.test(l));
  if (counterLine) {
    const m = counterLine.match(/^# Counter:\s*(\d+)/);
    if (m) counter = parseInt(m[1], 10);
  }

  const tasks = [];
  let i = 0;

  while (i < lines.length) {
    const headerMatch = lines[i].match(/^# (\d+) (.+)$/);
    if (!headerMatch) { i++; continue; }

    const id = parseInt(headerMatch[1], 10);
    const title = headerMatch[2].trim();

    // Skip to first non-blank line after header (metadata line)
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;

    if (j >= lines.length) {
      process.stderr.write(`Warning: Task #${id} "${title}" has no metadata line — skipping\n`);
      i++;
      continue;
    }

    const metaLine = lines[j].trim();
    const metaMatch = metaLine.match(
      /^##\s*(bug|feature|idea|tool|other)\s*\|\s*(todo|in_progress|done)\s*\|\s*(low|medium|high|critical)$/
    );

    if (!metaMatch) {
      process.stderr.write(
        `Warning: Task #${id} "${title}" has invalid metadata "${metaLine}" ` +
        `(expected "## {type} | {status} | {priority}") — skipping\n`
      );
      i = j + 1;
      continue;
    }

    const [, type, status, priority] = metaMatch;

    // Collect description lines until next # header or EOF
    const descLines = [];
    let k = j + 1;
    while (k < lines.length && !lines[k].match(/^# /)) {
      descLines.push(lines[k]);
      k++;
    }

    // Trim trailing blank lines
    while (descLines.length > 0 && descLines[descLines.length - 1].trim() === '') {
      descLines.pop();
    }

    tasks.push({ id, title, type, priority, status, description: descLines.join('\n') });
    i = k;
  }

  return { counter, tasks };
}

/**
 * Write tasks back to the markdown file atomically (write to .tmp then rename).
 *
 * @param {string} filePath
 * @param {number} counter
 * @param {Task[]} tasks
 */
export function writeTasks(filePath, counter, tasks) {
  const sorted = [...tasks].sort((a, b) => b.id - a.id);

  let content = `# Counter: ${counter}\n`;

  for (const task of sorted) {
    content += `\n# ${task.id} ${task.title}\n`;
    content += `## ${task.type} | ${task.status} | ${task.priority}\n`;
    if (task.description.trim()) {
      content += `${task.description}\n`;
    }
  }

  atomicWrite(filePath, content);
}

/**
 * Write archived done tasks to TASKS_DONE.md. No counter line — the archive
 * is a pure append target and does not mint ids.
 *
 * @param {string} filePath
 * @param {Task[]} tasks
 */
export function writeDoneTasks(filePath, tasks) {
  const sorted = [...tasks].sort((a, b) => b.id - a.id);

  let content = `# Done tasks\n`;

  for (const task of sorted) {
    content += `\n# ${task.id} ${task.title}\n`;
    content += `## ${task.type} | ${task.status} | ${task.priority}\n`;
    if (task.description.trim()) {
      content += `${task.description}\n`;
    }
  }

  atomicWrite(filePath, content);
}

function atomicWrite(filePath, content) {
  const tmpPath = filePath + '.tmp';
  try {
    writeFileSync(tmpPath, content, 'utf8');
    renameSync(tmpPath, filePath);
  } catch (err) {
    throw new Error(
      `FILE IS CORRUPTED: Failed to write tasks file "${filePath}" — ${err.message}. ` +
      `Stop any action and wait for instructions.`
    );
  }
}

/**
 * Word-wrap each line at maxLen, breaking on the closest previous whitespace.
 * Lines already within the limit are preserved verbatim, including blanks.
 * If no whitespace is found within the first maxLen chars of a remainder,
 * the line is hard-broken at maxLen (long unbreakable token — URLs, hashes).
 *
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
export function wrapLines(text, maxLen = 120) {
  if (!text) return text;
  const out = [];
  for (const line of text.split('\n')) {
    let remaining = line;
    while (remaining.length > maxLen) {
      let breakAt = -1;
      for (let k = maxLen; k > 0; k--) {
        if (/\s/.test(remaining[k])) { breakAt = k; break; }
      }
      if (breakAt < 0) {
        out.push(remaining.slice(0, maxLen));
        remaining = remaining.slice(maxLen);
      } else {
        out.push(remaining.slice(0, breakAt).replace(/\s+$/, ''));
        remaining = remaining.slice(breakAt + 1);
      }
    }
    out.push(remaining);
  }
  return out.join('\n');
}

/**
 * Sort tasks by priority desc, then id desc.
 */
export function sortByPriority(tasks) {
  return [...tasks].sort((a, b) => {
    const pd = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    return pd !== 0 ? pd : b.id - a.id;
  });
}

/**
 * Sort tasks for getNext: in_progress first, then priority desc, then id desc (FILO).
 */
export function sortForNext(tasks) {
  return [...tasks].sort((a, b) => {
    const sd = STATUS_ORDER[b.status] - STATUS_ORDER[a.status];
    if (sd !== 0) return sd;
    const pd = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    return pd !== 0 ? pd : b.id - a.id;
  });
}
