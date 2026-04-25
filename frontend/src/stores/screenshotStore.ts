import { create } from 'zustand';

export interface ScreenshotItem {
  id: string;
  blob: Blob;
  objectUrl: string;
  timestamp: number;
}

interface ScreenshotState {
  screenshots: ScreenshotItem[];
  addScreenshot: (blob: Blob) => void;
  removeScreenshot: (id: string) => void;
  updateScreenshot: (id: string, newBlob: Blob) => void;
  clearScreenshots: () => void;
}

export const useScreenshotStore = create<ScreenshotState>((set) => ({
  screenshots: [],
  addScreenshot: (blob: Blob) => set((state) => {
    const newScreenshot: ScreenshotItem = {
      id: Math.random().toString(36).substring(7) + Date.now().toString(36),
      blob,
      objectUrl: URL.createObjectURL(blob),
      timestamp: Date.now(),
    };
    
    // 最大 10 张，采用 FIFO 策略顶替最老的一张
    const updatedScreenshots = [...state.screenshots, newScreenshot];
    if (updatedScreenshots.length > 10) {
      // 释放被挤出的 Blob 的 ObjectURL 以防内存泄漏
      const removed = updatedScreenshots.shift();
      if (removed) {
        URL.revokeObjectURL(removed.objectUrl);
      }
    }
    return { screenshots: updatedScreenshots };
  }),
  removeScreenshot: (id: string) => set((state) => {
    const target = state.screenshots.find(s => s.id === id);
    if (target) {
      URL.revokeObjectURL(target.objectUrl);
    }
    return { screenshots: state.screenshots.filter(s => s.id !== id) };
  }),
  updateScreenshot: (id: string, newBlob: Blob) => set((state) => {
    return {
      screenshots: state.screenshots.map(s => {
        if (s.id === id) {
          URL.revokeObjectURL(s.objectUrl);
          return {
            ...s,
            blob: newBlob,
            objectUrl: URL.createObjectURL(newBlob),
            // 不改变 timestamp，保持原来的时间戳
          };
        }
        return s;
      })
    };
  }),
  clearScreenshots: () => set((state) => {
    state.screenshots.forEach(s => URL.revokeObjectURL(s.objectUrl));
    return { screenshots: [] };
  }),
}));
