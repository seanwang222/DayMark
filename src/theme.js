import { createTheme } from '@mui/material/styles';

/**
 * 应用主题（深色 GitHub 风格）
 * 通过 palette.github.* 暴露结构色，组件用 sx 引用
 * （如 bgcolor: 'background.paper' / color: 'github.blue' / borderColor: 'divider'）。
 * 优先级强调色（Q1~Q4）沿用 storage.TODO_PRIORITIES 的色值。
 */
const baseComponents = {
  MuiButton: {
    styleOverrides: {
      root: { textTransform: 'none', fontWeight: 500, borderRadius: '16px' },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        backgroundImage: 'none',
        boxShadow: 'none',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '16px',
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: { backgroundImage: 'none', borderRadius: '16px' },
    },
  },
  MuiBottomNavigation: {
    styleOverrides: {
      root: { backgroundImage: 'none', borderTop: '1px solid', borderColor: 'divider', height: 64 },
    },
  },
  MuiBottomNavigationAction: {
    styleOverrides: {
      root: { '&.Mui-selected': { paddingTop: 6 } },
    },
  },
  MuiChip: {
    styleOverrides: { root: { borderRadius: '16px' } },
  },
  MuiTextField: {
    styleOverrides: {
      root: { '& .MuiOutlinedInput-root': { borderRadius: '16px' } },
    },
  },
};

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#1f6feb', light: '#58a6ff', dark: '#388bfd', contrastText: '#ffffff' },
    secondary: { main: '#3fb950', light: '#56d364', dark: '#238636', contrastText: '#000000' },
    error: { main: '#f85149' },
    background: { default: '#0d1117', paper: '#161b22' },
    text: { primary: '#c9d1d9', secondary: '#8b949e', disabled: '#484f58' },
    divider: '#30363d',
    github: {
      surface2: '#21262d',
      border: '#30363d',
      muted: '#6e7681',
      blue: '#1f6feb',
      green: '#3fb950',
      red: '#f85149',
      yellow: '#d29922',
      inputBg: '#0d1117',
      hover: 'rgba(177, 186, 196, 0.08)',
    },
  },
  typography: {
    fontFamily: '"Noto Sans SC", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700, fontSize: '1.5rem' },
    h5: { fontWeight: 600, fontSize: '1.2rem' },
    h6: { fontWeight: 600, fontSize: '1rem' },
    body1: { fontSize: '0.95rem' },
    body2: { fontSize: '0.85rem' },
  },
  shape: { borderRadius: 16 },
  components: baseComponents,
});

export default theme;