// ─── 通知音效：使用 Web Audio API 合成提示音 ───
let audioCtx: AudioContext | null = null;
let lastPlayTime = 0;

/**
 * 播放消息提示音：清脆的 "叮" 声（A5 → E6 上扬正弦波 + 快速衰减）
 */
export const playDing = () => {
  try {
    const now = Date.now();
    // 防抖：200ms 内不重复播放
    if (now - lastPlayTime < 200) return;
    lastPlayTime = now;

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // 如果 AudioContext 被浏览器挂起（用户尚未交互），静默跳过
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
      return;
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // 清脆的叮声：高频正弦波 + 快速衰减
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);        // A5
    oscillator.frequency.setValueAtTime(1320, audioCtx.currentTime + 0.05); // E6 上扬

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.3);
  } catch {
    // 浏览器不支持 Web Audio 或用户未交互，静默忽略
  }
};

/**
 * 播放新工单提示音：双响低音 "嘟嘟"，区别于消息叮声（C5→G5 + C5→C6）
 */
export const playAlert = () => {
  try {
    const now = Date.now();
    if (now - lastPlayTime < 200) return;
    lastPlayTime = now;

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
      return;
    }

    // 第一声
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523, audioCtx.currentTime);      // C5
    osc1.frequency.setValueAtTime(784, audioCtx.currentTime + 0.06); // G5
    gain1.gain.setValueAtTime(0.35, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.2);

    // 第二声（间隔 0.25s）
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(523, audioCtx.currentTime + 0.25);
    osc2.frequency.setValueAtTime(1047, audioCtx.currentTime + 0.31); // C6 上扬
    gain2.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain2.gain.setValueAtTime(0.35, audioCtx.currentTime + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc2.start(audioCtx.currentTime + 0.25);
    osc2.stop(audioCtx.currentTime + 0.5);
  } catch {
    // 静默忽略
  }
};
