/**
 * Patch integrity tests — verify that our patch-package modifications
 * to react-native-image-viewing are correctly applied.
 *
 * These tests read the actual source files in node_modules and check
 * for key code signatures that our patch introduces. If any test fails,
 * it means the patch was not applied (run: npx patch-package).
 */

import * as fs from 'fs';
import * as path from 'path';

const LIB_ROOT = path.resolve(
  __dirname,
  '../../../node_modules/react-native-image-viewing/dist',
);

function readLibFile(relativePath: string): string {
  return fs.readFileSync(path.join(LIB_ROOT, relativePath), 'utf-8');
}

describe('react-native-image-viewing patch integrity', () => {
  it('patch file exists', () => {
    const patchPath = path.resolve(
      __dirname,
      '../../../patches/react-native-image-viewing+0.2.2.patch',
    );
    expect(fs.existsSync(patchPath)).toBe(true);
  });

  describe('ImageViewing.js — global tap-to-close + closeSignal', () => {
    let source: string;

    beforeAll(() => {
      source = readLibFile('ImageViewing.js');
    });

    it('imports useState for closeSignal', () => {
      expect(source).toContain('useState');
    });

    it('has closeSignal state', () => {
      expect(source).toContain('closeSignal');
    });

    it('has tap detection constants', () => {
      expect(source).toContain('DOUBLE_TAP_DELAY');
      expect(source).toContain('TAP_SLOP');
    });

    it('has onTouchStart/onTouchEnd on container', () => {
      expect(source).toContain('onTouchStart');
      expect(source).toContain('onTouchEnd');
    });

    it('passes closeSignal to ImageItem', () => {
      expect(source).toContain('closeSignal={closeSignal}');
    });
  });

  describe('ImageItem.ios.js — resetAndClose + closeSignal watcher', () => {
    let source: string;

    beforeAll(() => {
      source = readLibFile('components/ImageItem/ImageItem.ios.js');
    });

    it('imports useEffect', () => {
      expect(source).toContain('useEffect');
    });

    it('accepts closeSignal prop', () => {
      expect(source).toContain('closeSignal');
    });

    it('has resetAndClose function', () => {
      expect(source).toContain('resetAndClose');
    });

    it('resets zoom via scrollResponderZoomTo', () => {
      expect(source).toContain('scrollResponderZoomTo');
    });

    it('resets scroll position via scrollTo', () => {
      expect(source).toContain('scrollTo');
    });
  });

  describe('usePanResponder.js — hard boundary clamp (Android)', () => {
    let source: string;

    beforeAll(() => {
      source = readLibFile('hooks/usePanResponder.js');
    });

    it('uses hard clamp instead of elastic multiplier', () => {
      expect(source).toContain('nextTranslateX = leftBound');
      expect(source).toContain('nextTranslateX = rightBound');
      expect(source).toContain('nextTranslateY = topBound');
      expect(source).toContain('nextTranslateY = bottomBound');
    });

    it('does NOT use OUT_BOUND_MULTIPLIER for boundary check', () => {
      // The original elastic code pattern should be gone
      expect(source).not.toContain(
        '(nextTranslateX - leftBound) * OUT_BOUND_MULTIPLIER',
      );
    });
  });

  describe('useZoomPanResponder.js — hard boundary clamp', () => {
    let source: string;

    beforeAll(() => {
      source = readLibFile('hooks/useZoomPanResponder.js');
    });

    it('uses hard clamp instead of elastic multiplier', () => {
      expect(source).toContain('nextTranslateX = leftBound');
      expect(source).toContain('nextTranslateY = topBound');
    });

    it('does NOT use OUT_BOUND_MULTIPLIER for boundary check', () => {
      expect(source).not.toContain(
        '(nextTranslateX - leftBound) * OUT_BOUND_MULTIPLIER',
      );
    });
  });

  describe('useImageDimensions.js — cache protection', () => {
    let source: string;

    beforeAll(() => {
      source = readLibFile('hooks/useImageDimensions.js');
    });

    it('only caches valid dimensions (width > 0 && height > 0)', () => {
      expect(source).toContain('width > 0 && height > 0');
    });
  });
});
