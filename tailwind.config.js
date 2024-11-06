/** @type {import('tailwindcss').Config} */
import { themeDark, themeLight } from './src/theme/utils';
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  daisyui: {
    themes: [themeDark, themeLight],
  },
  theme: 'dark',
  plugins: [require('daisyui')],
}

