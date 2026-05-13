import TaskManager from './client/TaskManager';
import { Toaster } from './components/ui/sonner';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-[1080px] mx-auto px-8 py-5 flex items-center justify-between gap-6">
          <span className="font-bold uppercase tracking-widest text-lg text-foreground">
            task<span className="text-primary">/</span>manager
          </span>
          <span className="text-xs tracking-widest uppercase text-muted-foreground">
            simple-task-manager MCP UI
          </span>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-[1080px] mx-auto px-8 pt-12 pb-20">
          <TaskManager />
        </div>
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
