import { useEffect, useRef } from 'react';
import { engine } from '../engine/practiceEngine';
import { computeKeyboardLayout, computeSongRange } from '../lib/keyboardLayout';
import { filterNotesByHand } from '../lib/notes';

const LOOKAHEAD_SECONDS = 3;
const VIRTUAL_WIDTH = 1600;

export function FallingNotes() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let cssWidth = 0;
    let cssHeight = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cssWidth = container.clientWidth;
      cssHeight = container.clientHeight;
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const draw = () => {
      const state = engine.getSnapshot();
      const notes = filterNotesByHand(state.song, state.handFilter);
      const [minMidi, maxMidi] = computeSongRange(notes);
      const layout = computeKeyboardLayout(minMidi, maxMidi, VIRTUAL_WIDTH);
      const scaleX = cssWidth / VIRTUAL_WIDTH;
      const keyX = new Map(layout.keys.map((k) => [k.midi, { x: k.x * scaleX, width: k.width * scaleX, isBlack: k.isBlack }]));

      ctx.clearRect(0, 0, cssWidth, cssHeight);

      // lane background for black-key columns, for readability
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      for (const [, info] of keyX) {
        if (info.isBlack) ctx.fillRect(info.x, 0, info.width, cssHeight);
      }

      const pxPerSec = cssHeight / LOOKAHEAD_SECONDS;
      const hitLineY = cssHeight - 4;
      const songTime = state.songTime;

      for (const n of notes) {
        if (n.time + n.duration < songTime - 0.3) continue;
        if (n.time > songTime + LOOKAHEAD_SECONDS) continue;
        const info = keyX.get(n.midi);
        if (!info) continue;

        const durPx = Math.max(n.duration * pxPerSec, 8);
        const y = hitLineY - (n.time - songTime) * pxPerSec - durPx;

        const status = state.statuses.get(n.id);
        let fill = n.hand === 'left' ? '#a78bfa' : '#60a5fa';
        if (status === 'hit') fill = '#4ade80';
        else if (status === 'missed') fill = 'rgba(148,163,184,0.35)';

        ctx.fillStyle = fill;
        const w = Math.max(info.width - 4, 4);
        roundRect(ctx, info.x + 2, y, w, durPx, 4);
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(248,250,252,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, hitLineY);
      ctx.lineTo(cssWidth, hitLineY);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="falling-notes" ref={containerRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
