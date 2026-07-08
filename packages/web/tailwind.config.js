/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'muted-foreground': '#6b7280',
        charcoal: {
          bg: '#1c1c1f',
          surface: '#2a2a2e',
          raised: '#323238',
          border: '#3f3f46',
          text: '#e4e4e7',
          muted: '#a1a1aa',
          accent: '#5b8def',
        },
      },
    },
  },
  plugins: [],
}
