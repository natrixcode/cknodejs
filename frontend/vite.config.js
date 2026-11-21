import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, 'SERVER_PORT');
  const apiPort = env.SERVER_PORT || '3000';

  const proxy = {
    '/api/v1': `http://127.0.0.1:${apiPort}`
  };

  return {
    esbuild: {
      jsx: 'automatic'
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      proxy
    }
  };
});