import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Playback, eventTimes, nextEventTime, previousEventTime } from './playback';

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export interface PlaybackControls {
  /** Virtual time (ms) of the playhead. */
  t: number;
  duration: number;
  playing: boolean;
  speed: Speed;
  /** Auto-play is off (reduced motion): the user steps instead. */
  stepOnly: boolean;
  /** Stops worth stepping to (see `eventTimes`). */
  times: number[];
  setSpeed: (speed: Speed) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  stepForward: () => void;
  stepBack: () => void;
  toStart: () => void;
  toEnd: () => void;
}

/**
 * Playhead state for the shared time axis. It starts at the end so the complete picture is visible before
 * anyone presses play. With reduced motion there is no auto-play at all: the playhead moves only when the
 * user steps or scrubs. Mount it with `key={runId}` so a new run starts fresh.
 */
export function usePlayback(
  playback: Playback,
  options: { reducedMotion: boolean },
): PlaybackControls {
  const { duration } = playback;
  const [t, setT] = useState(duration);
  const [wantsPlay, setWantsPlay] = useState(false);
  const [speed, setSpeed] = useState<Speed>(2);
  const times = useMemo(() => eventTimes(playback), [playback]);
  const stepOnly = options.reducedMotion;
  const playing = wantsPlay && !stepOnly;

  const tRef = useRef(t);
  const timesRef = useRef(times);
  useEffect(() => {
    timesRef.current = times;
  }, [times]);

  const move = useCallback(
    (next: number) => {
      const clamped = Math.min(duration, Math.max(0, next));
      tRef.current = clamped;
      setT(clamped);
    },
    [duration],
  );

  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(duration, tRef.current + (now - last) * speed);
      last = now;
      tRef.current = next;
      setT(next);
      if (next >= duration) {
        setWantsPlay(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, speed, duration]);

  const play = useCallback(() => {
    if (stepOnly) return;
    if (tRef.current >= duration) move(0);
    setWantsPlay(true);
  }, [stepOnly, duration, move]);
  const pause = useCallback(() => {
    setWantsPlay(false);
  }, []);
  const seek = useCallback(
    (next: number) => {
      setWantsPlay(false);
      move(next);
    },
    [move],
  );

  return {
    t,
    duration,
    playing,
    speed,
    stepOnly,
    times,
    setSpeed,
    play,
    pause,
    toggle: () => {
      if (playing) pause();
      else play();
    },
    seek,
    stepForward: () => {
      seek(nextEventTime(timesRef.current, tRef.current));
    },
    stepBack: () => {
      seek(previousEventTime(timesRef.current, tRef.current));
    },
    toStart: () => {
      seek(0);
    },
    toEnd: () => {
      seek(duration);
    },
  };
}
