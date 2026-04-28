// ─── 标签页标题闪烁 ───
// 过滤掉脏标题数据（应对 Vite 热更新残留在 document.title 上的情况）
const ORIGINAL_TITLE = (document.title || 'CallCenter').replace(/🔴\s*\(\d+条新消息\)\s*/g, '').trim() || 'CallCenter';
let flashInterval: ReturnType<typeof setInterval> | null = null;
let currentFlashBadge = 0;

export const startTitleFlash = (badge: number) => {
  if (badge <= 0) {
    stopTitleFlash();
    return;
  }
  
  // 防止相同数量重复触发导致定时器频闪
  if (flashInterval && currentFlashBadge === badge) return;
  
  currentFlashBadge = badge;
  let showAlert = true;

  if (flashInterval) clearInterval(flashInterval);
  flashInterval = setInterval(() => {
    if (showAlert) {
      document.title = `🔴 (${badge}条新消息) ${ORIGINAL_TITLE}`;
    } else {
      document.title = ORIGINAL_TITLE;
    }
    showAlert = !showAlert;
  }, 1000);
};

export const stopTitleFlash = () => {
  if (flashInterval) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  currentFlashBadge = 0;
  if (document.title !== ORIGINAL_TITLE) {
    document.title = ORIGINAL_TITLE;
  }
};

/**
 * 注册 visibilitychange 监听器。
 * 需在初始化时调用一次，传入获取当前 badge 数量的回调。
 */
export const initVisibilityListener = (getBadge: () => number) => {
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (getBadge() <= 0) {
          stopTitleFlash();
        }
      }
    });
  }
};
