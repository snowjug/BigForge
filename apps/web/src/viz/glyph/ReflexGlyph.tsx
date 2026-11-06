import { useMemo } from 'react';
import { glyphFromHash } from './glyph';
import './glyph.css';

export interface ReflexGlyphProps {
  /** Content hash of the Reflex (sha-256 hex); any string is accepted. */
  hash: string;
  /** Side length in px (16 to 96 stay crisp). Default 32. */
  size?: number;
  /** When set the glyph is exposed as an image with this name; otherwise it is decorative. */
  title?: string;
  className?: string;
}

/**
 * A compact barcode/helix identity mark derived from a Reflex's content hash. Calm by design:
 * steel and ash strands with one or two ember accents, no animation.
 */
export function ReflexGlyph({ hash, size = 32, title, className }: ReflexGlyphProps) {
  const glyph = useMemo(() => glyphFromHash(hash), [hash]);
  const named = typeof title === 'string' && title !== '';
  const showRails = size >= 40;
  return (
    <svg
      className={className ? `bf-glyph ${className}` : 'bf-glyph'}
      width={size}
      height={size}
      viewBox={`0 0 ${glyph.box} ${glyph.box}`}
      role={named ? 'img' : undefined}
      aria-label={named ? title : undefined}
      aria-hidden={named ? undefined : true}
      focusable="false"
      shapeRendering={size < 40 ? 'crispEdges' : 'geometricPrecision'}
    >
      {named ? <title>{title}</title> : null}
      {showRails ? (
        <g className="bf-glyph__rails">
          <path d={glyph.rails[0]} />
          <path d={glyph.rails[1]} />
        </g>
      ) : null}
      {glyph.strands.map((strand, index) => (
        <rect
          key={index}
          className={`bf-glyph__strand bf-glyph__strand--${strand.tone}`}
          x={strand.x}
          y={strand.y}
          width={strand.w}
          height={strand.h}
          rx={size >= 40 ? 1.1 : 0}
        />
      ))}
    </svg>
  );
}
