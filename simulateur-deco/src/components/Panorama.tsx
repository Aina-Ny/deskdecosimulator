import { useEffect, useRef } from 'react';
import 'pannellum/build/pannellum.css';
import 'pannellum/build/pannellum.js';

interface Viewer {
  destroy(): void;
}
declare global {
  interface Window {
    pannellum: { viewer(el: HTMLElement, cfg: Record<string, unknown>): Viewer };
  }
}

/** Visionneuse 360° (panorama équirectangulaire, éventuellement partiel en hauteur). */
export function Panorama({ src, width, height }: { src: string; width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !window.pannellum) return;
    const vaov = Math.min(180, (360 * height) / width);
    const v = window.pannellum.viewer(ref.current, {
      type: 'equirectangular',
      panorama: src,
      autoLoad: true,
      haov: 360,
      vaov,
      minPitch: -vaov / 2,
      maxPitch: vaov / 2,
      hfov: 100,
      showFullscreenCtrl: true,
      compass: false,
    });
    return () => v.destroy();
  }, [src, width, height]);
  return <div ref={ref} className="panorama" />;
}
