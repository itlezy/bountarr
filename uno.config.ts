import { defineConfig, presetIcons, presetUno, presetWebFonts } from 'unocss';

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons(),
    presetWebFonts({
      provider: 'google',
      fonts: {
        sans: 'Manrope',
        display: 'Space Grotesk',
      },
    }),
  ],
  shortcuts: {
    card: 'rounded-3 border border-slate-900/10 bg-white/92 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.45)] dark:border-white/8 dark:bg-slate-950/70',
    pill: 'rounded-2 px-2.5 py-1 text-[11px] font-700 tracking-0.08em uppercase',
    action:
      'inline-flex items-center justify-center rounded-2 border border-slate-900/12 bg-slate-950 px-4 py-2.5 text-sm font-700 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100',
  },
  theme: {
    colors: {
      ink: '#102033',
      mist: '#eff5fb',
      coral: '#f97360',
      gold: '#f5b94d',
      mint: '#5bc18f',
    },
  },
});
