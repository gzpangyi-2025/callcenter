import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeAudioParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect = vi.fn();
}

class FakeOscillatorNode {
  type: OscillatorType = 'sine';
  frequency = new FakeAudioParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static nextState: AudioContextState = 'running';

  state: AudioContextState;
  currentTime = 10;
  destination = { nodeType: 'destination' };
  oscillators: FakeOscillatorNode[] = [];
  gains: FakeGainNode[] = [];
  resume = vi.fn<() => Promise<void>>().mockImplementation(async () => {
    this.state = 'running';
  });

  constructor() {
    this.state = FakeAudioContext.nextState;
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  createGain() {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }
}

const loadSoundUtils = async () => {
  vi.resetModules();
  FakeAudioContext.instances = [];
  FakeAudioContext.nextState = 'running';
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: FakeAudioContext,
  });
  return import('./soundUtils');
};

describe('soundUtils', () => {
  beforeEach(() => {
    vi.spyOn(window, 'addEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(window, 'AudioContext');
  });

  it('registers one-time audio unlock event listeners on import', async () => {
    await loadSoundUtils();

    const calls = vi.mocked(window.addEventListener).mock.calls;
    expect(
      calls.some(
        ([eventName, listener, options]) =>
          eventName === 'pointerdown' &&
          typeof listener === 'function' &&
          options === Object(options) &&
          'passive' in options &&
          options.passive === true,
      ),
    ).toBe(true);
    expect(
      calls.some(
        ([eventName, listener, options]) =>
          eventName === 'keydown' &&
          typeof listener === 'function' &&
          options === Object(options) &&
          'passive' in options &&
          options.passive === true,
      ),
    ).toBe(true);
  });

  it('plays a ding tone using one oscillator and gain node', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { playDing } = await loadSoundUtils();

    playDing();

    const [ctx] = FakeAudioContext.instances;
    const [oscillator] = ctx.oscillators;
    const [gain] = ctx.gains;
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(880, 10);
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(1320, 10.05);
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.001, 10.3);
    expect(oscillator.start).toHaveBeenCalledWith(10);
    expect(oscillator.stop).toHaveBeenCalledWith(10.3);
  });

  it('debounces sounds played within 200ms', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_100);
    const { playDing } = await loadSoundUtils();

    playDing();
    playDing();

    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(1);
  });

  it('plays the alert tone as two oscillator bursts', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { playAlert } = await loadSoundUtils();

    playAlert();

    const [ctx] = FakeAudioContext.instances;
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(523, 10);
    expect(ctx.oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(1047, 10.31);
  });

  it('resumes suspended audio before playing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { playDing } = await loadSoundUtils();
    FakeAudioContext.nextState = 'suspended';

    playDing();
    await Promise.resolve();

    const [ctx] = FakeAudioContext.instances;
    expect(ctx.resume).toHaveBeenCalled();
  });
});
