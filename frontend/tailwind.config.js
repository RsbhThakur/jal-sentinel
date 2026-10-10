/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        sentinel: {
          dark: '#0B0F19',
          card: '#111827',
          border: '#1F2937',
          blue: '#2563EB',
          cyan: '#06B6D4',
          alert: '#EF4444',
          warning: '#F59E0B',
          success: '#10B981',
        },
      },
    },
  },
  plugins: [],
};
