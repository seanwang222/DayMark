import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3000,
    // 端口被占用时直接报错，而不是静默换到 3001：
    // Electron 开发模式固定加载 localhost:3000，换端口会让窗口显示别人的（或旧的）页面
    strictPort: true,
    open: false,
  },
});
