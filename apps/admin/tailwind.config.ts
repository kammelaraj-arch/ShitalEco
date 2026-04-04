import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        crimson: {
          50:  '#fff1f1', 100: '#ffe0e0', 200: '#ffc5c5',
          300: '#ff9d9d', 400: '#ff6464', 500: '#e01010',
          600: '#c01010', 700: '#b91c1c', 800: '#9b1212', 900: '#7f1010',
        },
        saffron: {
          50: '#fff8f0', 100: '#ffecd0', 200: '#ffd49f',
          300: '#ffb766', 400: '#ff9933', 500: '#ff7700',
          600: '#e55e00', 700: '#bf4800', 800: '#993800', 900: '#7a2d00',
        },
        temple: {
          deep: '#0d0404', dark: '#180a0a', card: '#200606',
          border: 'rgba(185,28,28,0.18)',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial':   'radial-gradient(var(--tw-gradient-stops))',
        'saffron-gradient':  'linear-gradient(135deg, #FF9933, #FF6B35)',
        'crimson-gradient':  'linear-gradient(135deg, #B91C1C, #7f1010)',
        'gold-gradient':     'linear-gradient(135deg, #FFD700, #FFA500, #FF6B35)',
      },
      animation: {
        'slide-up':    'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in':     'fadeIn 0.3s ease-out',
        'number-tick': 'numberTick 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        slideUp:     { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        fadeIn:      { from: { opacity: '0' }, to: { opacity: '1' } },
        numberTick:  { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      boxShadow: {
        'saffron':    '0 4px 24px rgba(255, 153, 51, 0.25)',
        'saffron-lg': '0 8px 40px rgba(255, 153, 51, 0.3)',
        'crimson':    '0 4px 24px rgba(185, 28, 28, 0.35)',
        'crimson-lg': '0 8px 40px rgba(185, 28, 28, 0.4)',
        'dark':       '0 4px 24px rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [],
}
export default config
