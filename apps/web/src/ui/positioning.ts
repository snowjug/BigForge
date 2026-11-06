/** Pure anchored-positioning maths for tooltips, popovers and menus (unit-tested, no DOM access). */

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PositionInput {
  /** The trigger's bounding box in viewport coordinates. */
  anchor: Box;
  floating: Size;
  viewport: Size;
  side?: Side;
  align?: Align;
  /** Gap between anchor and floating element. */
  offset?: number;
  /** Minimum distance kept from the viewport edge. */
  padding?: number;
}

export interface PositionResult {
  x: number;
  y: number;
  side: Side;
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function computePosition(input: PositionInput): PositionResult {
  const { anchor, floating, viewport } = input;
  const preferred = input.side ?? 'bottom';
  const align = input.align ?? 'center';
  const offset = input.offset ?? 8;
  const padding = input.padding ?? 8;

  const room = (side: Side): number => {
    switch (side) {
      case 'top':
        return anchor.y - offset - padding;
      case 'bottom':
        return viewport.height - (anchor.y + anchor.height) - offset - padding;
      case 'left':
        return anchor.x - offset - padding;
      case 'right':
        return viewport.width - (anchor.x + anchor.width) - offset - padding;
    }
  };
  const need = (side: Side): number =>
    side === 'top' || side === 'bottom' ? floating.height : floating.width;
  const fits = (side: Side): boolean => room(side) >= need(side);

  let side = preferred;
  if (!fits(preferred)) {
    const opposite = OPPOSITE[preferred];
    if (fits(opposite) || room(opposite) > room(preferred)) side = opposite;
  }

  let x: number;
  let y: number;
  if (side === 'top' || side === 'bottom') {
    y = side === 'top' ? anchor.y - offset - floating.height : anchor.y + anchor.height + offset;
    x =
      align === 'start'
        ? anchor.x
        : align === 'end'
          ? anchor.x + anchor.width - floating.width
          : anchor.x + anchor.width / 2 - floating.width / 2;
  } else {
    x = side === 'left' ? anchor.x - offset - floating.width : anchor.x + anchor.width + offset;
    y =
      align === 'start'
        ? anchor.y
        : align === 'end'
          ? anchor.y + anchor.height - floating.height
          : anchor.y + anchor.height / 2 - floating.height / 2;
  }

  return {
    x: clamp(x, padding, viewport.width - floating.width - padding),
    y: clamp(y, padding, viewport.height - floating.height - padding),
    side,
  };
}
