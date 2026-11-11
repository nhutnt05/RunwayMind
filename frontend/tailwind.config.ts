import type { Config } from 'tailwindcss';

// Breakpoints follow docs/08 §9 (Tailwind defaults: sm 640, md 768, lg 1024, xl 1280).
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#e84142', dark: '#b8322f' },
      },
    },
  },
  plugins: [],
};

export default config;
