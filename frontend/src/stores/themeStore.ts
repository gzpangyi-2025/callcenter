import { create } from 'zustand';

interface ThemeState {
  theme: string;
  setTheme: (t: string) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const initialTheme = localStorage.getItem('app-theme') || 'trustfar';
  // 初始挂载主题到 html 标签
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', initialTheme);
  }
  
  return {
    theme: initialTheme,
    setTheme: (theme: string) => {
      localStorage.setItem('app-theme', theme);
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme);
      }
      set({ theme });
    },
  };
});
