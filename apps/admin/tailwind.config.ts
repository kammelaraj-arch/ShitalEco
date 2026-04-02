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
        saffron: {
          50: '#fff8f0', 100: '#ffecd0', 200: '#ffd49f',
          300: '#ffb766', 400: '#ff9933', 500: '#ff7700',
          600: '#e55e00', 700: '#bf4800', 800: '#993800', 900: '#7a2d00',
        },
        temple: {
          deep: '#0f0700', dark: '#1a0a00', card: '#1e0e02',
          border: 'rgba(255,153,51,0.12)',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'saffron-gradient': 'linear-gradient(135deg, #FF9933, #FF6B35)',
        'gold-gradient': 'linear-gradient(135deg, #FFD700, #FFA500, #FF6B35)',
      },
      animation: {
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fadeIn 0.3s ease-out',
        'number-tick': 'numberTick 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        slideUp: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        numberTick: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      boxShadow: {
        'saffron': '0 4px 24px rgba(255, 153, 51, 0.25)',
        'saffron-lg': '0 8px 40px rgba(255, 153, 51, 0.3)',
        'dark': '0 4px 24px rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [],
}
export default config
