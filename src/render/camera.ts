// One uniform scale, whole world on screen. This is the aerial-view rule from docs/PLAN.md §6:
// no follow camera, no per-organism zoom.

export interface Camera {
  /** Canvas pixels (device pixels) per world unit. */
  scale: number;
  /** Device-pixel offset of world origin (0,0). */
  offsetX: number;
  offsetY: number;
  /** Device-pixel size of the world as drawn. */
  drawnWidth: number;
  drawnHeight: number;
}

export function fitCamera(worldWidth: number, worldHeight: number, pixelWidth: number, pixelHeight: number): Camera {
  const scale = Math.min(pixelWidth / worldWidth, pixelHeight / worldHeight);
  const drawnWidth = worldWidth * scale;
  const drawnHeight = worldHeight * scale;
  return {
    scale,
    offsetX: (pixelWidth - drawnWidth) / 2,
    offsetY: (pixelHeight - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  };
}

export const toWorldX = (camera: Camera, pixelX: number): number => (pixelX - camera.offsetX) / camera.scale;
export const toWorldY = (camera: Camera, pixelY: number): number => (pixelY - camera.offsetY) / camera.scale;
export const toPixelX = (camera: Camera, worldX: number): number => worldX * camera.scale + camera.offsetX;
export const toPixelY = (camera: Camera, worldY: number): number => worldY * camera.scale + camera.offsetY;

/** Pointer coordinates arrive in CSS pixels; the canvas backing store is in device pixels. */
export const cssToDevice = (cssValue: number, dpr: number): number => cssValue * dpr;
