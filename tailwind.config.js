/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wow: {
          gold: '#e8a525',
          'gold-dark': '#b87d1a',
          dark: '#1a120a',
          'dark-2': '#241a10',
          'dark-3': '#3d2814',
          accent: '#c45e20',
          success: '#4caf50',
          warning: '#e88a30',
          error: '#c43030',
          blue: '#3ba4d8',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  },
  plugins: []
}
