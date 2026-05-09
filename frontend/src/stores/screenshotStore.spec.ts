import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenshotStore } from './screenshotStore';

const objectUrlFor = (blob: Blob) => `blob:${blob.size}:${blob.type}`;

describe('screenshotStore', () => {
  beforeEach(() => {
    useScreenshotStore.setState({ screenshots: [] });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(objectUrlFor);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds screenshots with generated object URLs', () => {
    const blob = new Blob(['image'], { type: 'image/png' });

    useScreenshotStore.getState().addScreenshot(blob);

    const [item] = useScreenshotStore.getState().screenshots;
    expect(item).toMatchObject({
      blob,
      objectUrl: 'blob:5:image/png',
      timestamp: 1_700_000_000_000,
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('keeps only the latest ten screenshots and revokes the oldest URL', () => {
    for (let i = 0; i < 11; i++) {
      useScreenshotStore.getState().addScreenshot(new Blob([String(i)]));
    }

    expect(useScreenshotStore.getState().screenshots).toHaveLength(10);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1:');
  });

  it('removes screenshots and revokes their object URLs', () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    useScreenshotStore.getState().addScreenshot(blob);
    const [item] = useScreenshotStore.getState().screenshots;

    useScreenshotStore.getState().removeScreenshot(item.id);

    expect(useScreenshotStore.getState().screenshots).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(item.objectUrl);
  });

  it('updates screenshot blobs without changing their timestamp', () => {
    const initialBlob = new Blob(['old']);
    const updatedBlob = new Blob(['new-data'], { type: 'image/jpeg' });
    useScreenshotStore.getState().addScreenshot(initialBlob);
    const [initialItem] = useScreenshotStore.getState().screenshots;

    useScreenshotStore.getState().updateScreenshot(initialItem.id, updatedBlob);

    const [updatedItem] = useScreenshotStore.getState().screenshots;
    expect(updatedItem).toMatchObject({
      id: initialItem.id,
      blob: updatedBlob,
      objectUrl: 'blob:8:image/jpeg',
      timestamp: initialItem.timestamp,
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(initialItem.objectUrl);
  });

  it('clears screenshots and revokes all object URLs', () => {
    useScreenshotStore.getState().addScreenshot(new Blob(['one']));
    useScreenshotStore.getState().addScreenshot(new Blob(['two']));

    useScreenshotStore.getState().clearScreenshots();

    expect(useScreenshotStore.getState().screenshots).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
