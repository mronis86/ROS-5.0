const path = require('path');

/** Absolute paths so Tailwind scans the right files when server cwd is not ui/ */
const uiRoot = __dirname;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(uiRoot, 'index.html'),
    path.join(uiRoot, 'src/**/*.{js,jsx,ts,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
          500: '#64748b',
          400: '#94a3b8',
          300: '#cbd5e1',
          200: '#e2e8f0',
          100: '#f1f5f9',
          50: '#f8fafc',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
