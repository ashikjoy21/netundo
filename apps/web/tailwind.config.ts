import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        cf: {
          orange: '#f6821f',
          'orange-light': '#ffecd9',
          'orange-dark': '#e07010',
          purple: '#7c3aed',
          'purple-light': '#ede9fe',
          'purple-dark': '#6d28d9',
          green: '#22c55e',
          red: '#ef4444',
          blue: '#3b82f6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
