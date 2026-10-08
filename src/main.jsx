import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import theme from './theme';
import { initPersistence } from './utils/persistence';
import './index.css';
import './App.css';

// 桌面版：先加载本机快照回填 localStorage，再渲染（浏览器版立即渲染）
initPersistence().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        <HashRouter>
          <App />
        </HashRouter>
      </MuiThemeProvider>
    </React.StrictMode>
  );
});