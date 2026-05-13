import { defineConfig } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function copyStaticImages() {
  return {
    name: 'copy-static-images',
    closeBundle() {
      const source = resolve(__dirname, 'images');
      const destination = resolve(__dirname, 'dist/images');
      if (existsSync(source)) {
        cpSync(source, destination, { recursive: true });
      }
    }
  };
}

export default defineConfig({
  plugins: [copyStaticImages()],
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
