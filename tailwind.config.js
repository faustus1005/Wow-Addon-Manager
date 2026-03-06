/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wow: {
          gold: '#ffd100',
          'gold-dark': '#c9a227',
          dark: '#1a1a2e',
          'dark-2': '#16213e',
          'dark-3': '#0f3460',
          accent: '#533483',
          success: '#4caf50',
          warning: '#ff9800',
          error: '#f44336',
          blue: '#00b4d8',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  },
  plugins: []
}
