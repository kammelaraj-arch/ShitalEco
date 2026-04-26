/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        temple: {
          bg:      '#B80000',
          deep:    '#8B0000',
          mid:     '#A00000',
          surface: '#C41010',
          raised:  '#D01818',
        },
        gold: {
          100: '#FFF8DC',
          200: '#FAE28A',
          300: '#F5C842',
          400: '#D4AF37',
          500: '#C5A028',
          600: '#B8860B',
          glow: '#FFD700',
        },
        saffron: {
          300: '#FFB347',
          400: '#FF9933',
          500: '#FF7700',
          600: '#E65C00',
        },
        crimson: {
          500: '#C62828',
          600: '#B71C1C',
          700: '#7F0000',
        },
        ivory: {
          100: '#FFFFF0',
          200: '#FFF8DC',
          300: '#FAF0E6',
          400: '#F5DEB3',
        },
      },
      fontFamily: {
        display: ['Cinzel', 'Georgia', 'serif'],
        sans:    ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'spin-slow':    'spin 3s linear infinite',
        'gold-shimmer': 'goldShimmer 3s ease-in-out infinite',
        'diya-pulse':   'diyaPulse 2s ease-in-out infinite',
        'float':        'float 4s ease-in-out infinite',
      },
      keyframes: {
        goldShimmer: {
          '0%,100%': { backgroundPosition: '0% 50%' },
          '50%':     { backgroundPosition: '100% 50%' },
        },
        diyaPulse: {
          '0%,100%': { boxShadow: '0 0 10px rgba(212,175,55,0.25)' },
          '50%':     { boxShadow: '0 0 30px rgba(212,175,55,0.55), 0 0 60px rgba(255,153,51,0.2)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%':     { transform: 'translateY(-8px)' },
        },
      },
    },
  },
  plugins: [],
}
