import { Check, Circle, TriangleAlert } from 'lucide-react';
import { type StorySummary } from './model';

const ICON = {
  done: <Check size={13} strokeWidth={2.5} />,
  alert: <TriangleAlert size={13} strokeWidth={2.25} />,
  pending: <Circle size={11} strokeWidth={2} />,
} as const;

const TARGET: Record<StorySummary['id'], string> = {
  environment: '#drift-environment',
  canary: '#drift-canary',
  confidence: '#drift-confidence',
  lifecycle: '#drift-lifecycle',
  mutation: '#drift-mutation',
};

/** The five beats of the drift story with where each stands. Anchors jump to the stage. */
export function StoryStrip({ stages }: { stages: readonly StorySummary[] }) {
  return (
    <nav className="drift-story" aria-label="The drift story, step by step">
      <ol>
        {stages.map((stage, index) => (
          <li key={stage.id} data-state={stage.state}>
            <a href={TARGET[stage.id]} className="drift-story__link">
              <span className="drift-story__mark" aria-hidden="true">
                {ICON[stage.state]}
              </span>
              <span className="drift-story__text">
                <span className="drift-story__label">
                  <span className="drift-story__n">{index + 1}</span> {stage.label}
                </span>
                <span className="drift-story__note">{stage.note}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
