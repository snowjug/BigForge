import type { StepKind } from '@bigforge/schemas';
import type { NodeState } from './types';

/**
 * Kind and state glyphs, drawn around (0,0) in a ~10px box. Shapes carry the meaning, colour only
 * reinforces it: known = filled square, validation = hollow square, hybrid = square with an ember
 * notch, boundary = lens, verification = padlock (open until the result is locked).
 */
export function KindGlyph({ kind, locked = false }: { kind: StepKind; locked?: boolean }) {
  switch (kind) {
    case 'known':
      return <rect className="bf-ico bf-ico--fill" x={-4} y={-4} width={8} height={8} rx={1.6} />;
    case 'validation':
      return (
        <rect className="bf-ico bf-ico--line" x={-3.3} y={-3.3} width={6.6} height={6.6} rx={1.4} />
      );
    case 'hybrid':
      return (
        <>
          <rect className="bf-ico bf-ico--fill" x={-4} y={-4} width={8} height={8} rx={1.6} />
          <path className="bf-ico__notch" d="M0 -4.2H4.2V0Z" />
        </>
      );
    case 'boundary':
      return <path className="bf-ico bf-ico--fill" d="M-5.4 0Q0 -6.2 5.4 0Q0 6.2 -5.4 0Z" />;
    case 'verification':
      return (
        <>
          <rect
            className="bf-ico bf-ico--fill"
            x={-3.8}
            y={-0.6}
            width={7.6}
            height={5.2}
            rx={1.2}
          />
          <path
            className="bf-ico bf-ico--line"
            d={
              locked
                ? 'M-2.2 -0.6V-2.3A2.2 2.2 0 0 1 2.2 -2.3V-0.6'
                : 'M-2.2 -0.6V-2.3A2.2 2.2 0 0 1 2.2 -2.3'
            }
          />
        </>
      );
  }
}

/** Glyph for a runtime state (nothing for `idle`: quiet by design). */
export function StateGlyph({ state }: { state: NodeState }) {
  switch (state) {
    case 'idle':
      return null;
    case 'running':
      return <path className="bf-sico bf-sico--fill" d="M-2.6 -3.8L4 0L-2.6 3.8Z" />;
    case 'done':
      return <path className="bf-sico bf-sico--line" d="M-4 0.2L-1.3 3L4 -2.8" />;
    case 'boundary':
      return (
        <>
          <circle className="bf-sico bf-sico--line" r={4.4} />
          <circle className="bf-sico bf-sico--fill" r={1.8} />
        </>
      );
    case 'verified':
      return (
        <>
          <circle className="bf-sico bf-sico--line" r={5.6} />
          <path className="bf-sico bf-sico--line" d="M-2.8 0.2L-0.8 2.2L2.9 -2" />
        </>
      );
    case 'stopped':
      return <path className="bf-sico bf-sico--line" d="M-3.2 -3.2L3.2 3.2M3.2 -3.2L-3.2 3.2" />;
    case 'skipped':
      return <path className="bf-sico bf-sico--line" d="M-4.6 0H-1.6M1.6 0H4.6" />;
  }
}
