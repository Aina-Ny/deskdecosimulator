import { useEffect, useRef, useState } from 'react';
import type { PreparedSource } from '../lib/image';

interface Props {
  source: PreparedSource;
  mask: HTMLCanvasElement;
  onChange: () => void;
}

/** Peinture des zones protégées : leurs pixels d'origine sont recollés après génération. */
export function MaskEditor({ source, mask, onChange }: Props) {
  const view = useRef<HTMLCanvasElement>(null);
  const [brush, setBrush] = useState(40);
  const [mode, setMode] = useState<'paint' | 'erase'>('paint');
  const history = useRef<ImageData[]>([]);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const redraw = () => {
    const v = view.current;
    if (!v) return;
    const ctx = v.getContext('2d')!;
    ctx.clearRect(0, 0, v.width, v.height);
    ctx.drawImage(mask, 0, 0);
  };

  useEffect(() => {
    const v = view.current!;
    v.width = source.width;
    v.height = source.height;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const toCanvas = (e: React.PointerEvent) => {
    const rect = view.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * source.width,
      y: ((e.clientY - rect.top) / rect.height) * source.height,
    };
  };

  const stroke = (to: { x: number; y: number }) => {
    const ctx = mask.getContext('2d')!;
    ctx.globalCompositeOperation = mode === 'paint' ? 'source-over' : 'destination-out';
    ctx.strokeStyle = '#ff3b30';
    ctx.fillStyle = '#ff3b30';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const scale = source.width / view.current!.getBoundingClientRect().width;
    ctx.lineWidth = brush * scale;
    const from = last.current ?? to;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    last.current = to;
    redraw();
  };

  const snapshot = () => {
    const ctx = mask.getContext('2d')!;
    history.current.push(ctx.getImageData(0, 0, mask.width, mask.height));
    if (history.current.length > 30) history.current.shift();
  };

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    mask.getContext('2d')!.putImageData(prev, 0, 0);
    redraw();
    onChange();
  };

  const clear = () => {
    snapshot();
    mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
    redraw();
    onChange();
  };

  return (
    <div className="mask-editor">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Outil">
          <button className={mode === 'paint' ? 'active' : ''} onClick={() => setMode('paint')}>Protéger</button>
          <button className={mode === 'erase' ? 'active' : ''} onClick={() => setMode('erase')}>Gommer</button>
        </div>
        <label className="range">
          Pinceau
          <input type="range" min={8} max={140} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
        </label>
        <button className="ghost" onClick={undo}>Annuler</button>
        <button className="ghost" onClick={clear}>Tout effacer</button>
      </div>
      <div className="mask-stage">
        <img src={source.dataUrl} alt="Photo du bureau" draggable={false} />
        <canvas
          ref={view}
          className="mask-overlay"
          style={{ cursor: 'crosshair' }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            snapshot();
            drawing.current = true;
            last.current = null;
            stroke(toCanvas(e));
          }}
          onPointerMove={(e) => drawing.current && stroke(toCanvas(e))}
          onPointerUp={() => {
            drawing.current = false;
            last.current = null;
            onChange();
          }}
          onPointerCancel={() => (drawing.current = false)}
        />
      </div>
    </div>
  );
}
