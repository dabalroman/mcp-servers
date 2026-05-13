import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const taskApiPlugin: PluginOption = {
  name: 'task-api',
  configureServer(server) {
    return import('./src/server/taskRouter.js').then(({ mountTaskApi }) => {
      const { dispose } = mountTaskApi(server.middlewares);
      server.httpServer?.once('close', dispose);
    });
  },
};

export default defineConfig({
  plugins: [react(), taskApiPlugin],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-ui': ['@radix-ui/react-dialog', 'class-variance-authority', 'clsx', 'tailwind-merge', 'lucide-react'],
          'vendor-misc': ['sonner'],
        },
      },
    },
  },
  server: { port: 7374, host: true },
});
