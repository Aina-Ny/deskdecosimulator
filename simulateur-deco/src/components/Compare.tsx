import { useState } from 'react';

/** Comparaison avant / après par curseur. */
export function Compare({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="compare">
      <img src={after} alt="Après" draggable={false} />
      <div className="compare-before" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={before} alt="Avant" draggable={false} />
      </div>
      <div className="compare-line" style={{ left: `${pos}%` }} />
      <span className="tag tag-left">Avant</span>
      <span className="tag tag-right">Après</span>
      <input
        aria-label="Curseur avant/après"
        className="compare-range"
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
      />
    </div>
  );
}
