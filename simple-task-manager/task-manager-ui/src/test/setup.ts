// Runs before every test file. Overrides TASKS_DB so no test can accidentally
// read or write real user data. Tests that need their own fresh DB create
// temp dirs via os.tmpdir() and call createTaskStore directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach } from 'vitest';

let tasksDbDir = '';

function createDir() {
  tasksDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-db-default-'));
  process.env.TASKS_DB = path.join(tasksDbDir, 'tasks.db');
}

createDir();

beforeEach(() => {
  createDir();
});

afterEach(() => {
  fs.rmSync(tasksDbDir, { recursive: true, force: true });
});
