/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        primary: '#7c4dff',
        secondary: '#00e676',
        accent: '#ff5252',
        dark: {
          bg: '#121212',
          surface: '#1e1e2e',
          card: '#252538',
          border: '#2d2d44',
        },
      },
      fontFamily: {
        sans: ['Noto Sans SC', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
