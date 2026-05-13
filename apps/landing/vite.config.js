import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        project: resolve(__dirname, 'project.html'),
        admin: resolve(__dirname, 'admin.html'),
        adminIndex: resolve(__dirname, 'admin/index.html')
      }
    }
  }
});
