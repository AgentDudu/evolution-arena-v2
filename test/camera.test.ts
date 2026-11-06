import { describe, expect, it } from 'vitest';

import { cssToDevice, fitCamera, toPixelX, toPixelY, toWorldX, toWorldY } from '../src/render/camera.ts';

describe('fitCamera', () => {
  it('shows the whole world with one uniform scale', () => {
    const c = fitCamera(1600, 900, 1280, 720);
    expect(c.scale).toBeCloseTo(0.8, 10);
    expect(c.drawnWidth).toBeCloseTo(1280, 10);
    expect(c.drawnHeight).toBeCloseTo(720, 10);
    expect(c.offsetX).toBeCloseTo(0, 10);
    expect(c.offsetY).toBeCloseTo(0, 10);
  });

  it('letterboxes instead of stretching when the aspect differs', () => {
    const c = fitCamera(1600, 900, 1000, 1000);
    expect(c.scale).toBeCloseTo(0.625, 10); // width-limited
    expect(c.drawnWidth).toBeCloseTo(1000, 10);
    expect(c.drawnHeight).toBeCloseTo(562.5, 10);
    expect(c.offsetX).toBeCloseTo(0, 10);
    expect(c.offsetY).toBeCloseTo(218.75, 10);
    // the world still fits vertically with a single scale
    expect(c.drawnHeight).toBeLessThanOrEqual(1000);
    expect(c.drawnWidth).toBeLessThanOrEqual(1000);
  });

  it('fits a tall world into a wide viewport', () => {
    const c = fitCamera(600, 1800, 1920, 1080);
    expect(c.scale).toBeCloseTo(0.6, 10); // height-limited
    expect(c.drawnHeight).toBeCloseTo(1080, 10);
    expect(c.offsetX).toBeCloseTo((1920 - 360) / 2, 10);
  });

  it('device pixels and css pixels round-trip through world coordinates', () => {
    const dpr = 2;
    const c = fitCamera(1600, 900, cssToDevice(1280, dpr), cssToDevice(720, dpr));
    for (const cssX of [0, 300, 1279.5]) {
      for (const cssY of [0, 400, 719.25]) {
        const wx = toWorldX(c, cssToDevice(cssX, dpr));
        const wy = toWorldY(c, cssToDevice(cssY, dpr));
        const backX = toPixelX(c, wx) / dpr;
        const backY = toPixelY(c, wy) / dpr;
        expect(backX).toBeCloseTo(cssX, 8);
        expect(backY).toBeCloseTo(cssY, 8);
      }
    }
  });

  it('maps the world corners onto the drawn rectangle', () => {
    const c = fitCamera(1600, 900, 1000, 1000);
    expect(toPixelX(c, 0)).toBeCloseTo(c.offsetX, 10);
    expect(toPixelX(c, 1600)).toBeCloseTo(c.offsetX + c.drawnWidth, 10);
    expect(toPixelY(c, 900)).toBeCloseTo(c.offsetY + c.drawnHeight, 10);
  });
});
