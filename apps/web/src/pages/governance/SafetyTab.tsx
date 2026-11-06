import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  ShieldCheck,
  ShieldX,
  Terminal,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../../api/client';
import { useEvaluateCommand } from '../../api/hooks';
import { Button, Chip, EmptyState, ErrorState, Field, Panel, cx } from '../../ui';
import { PRESETS, type Preset, type StageState, stagesOf } from './safety';

const STAGE_ICON: Record<StageState, ReactNode> = {
  pass: <CircleCheck size={16} aria-hidden="true" />,
  fail: <CircleX size={16} aria-hidden="true" />,
  skipped: <CircleDashed size={16} aria-hidden="true" />,
};
const STAGE_WORD: Record<StageState, string> = {
  pass: 'Passed',
  fail: 'Failed',
  skipped: 'Not reached',
};

const KIND_LABEL: Record<Preset['kind'], string> = {
  valid: 'valid',
  destructive: 'destructive',
  metacharacters: 'shell',
  traversal: 'path',
  flag: 'flag',
};

/**
 * The Command Safety playground: type or pick a command and watch it go through the staged policy.
 * The server only evaluates; it never executes. `executed: false` is stated, not implied.
 */
export function SafetyTab() {
  const [command, setCommand] = useState(PRESETS[0]?.command ?? '');
  const [activePreset, setActivePreset] = useState<string | null>(PRESETS[0]?.id ?? null);
  const evaluate = useEvaluateCommand();
  const result = evaluate.data;

  const run = (text: string, presetId: string | null) => {
    setCommand(text);
    setActivePreset(presetId);
    if (text.trim()) evaluate.mutate(text);
  };

  return (
    <div className="gov-tab gov-safety">
      <div className="gov-safety__input">
        <p className="gov-lede">
          BigForge never executes shell text. Commands must be structured, on an allowlist and
          granted by the Reflex’s permissions. Try one: nothing here is ever run.
        </p>
        <form
          className="gov-safety__form"
          onSubmit={(event) => {
            event.preventDefault();
            run(command, PRESETS.find((preset) => preset.command === command)?.id ?? null);
          }}
        >
          <Field
            label="Command line"
            help="Evaluated by POST /api/security/evaluate. Maximum 2,000 characters."
          >
            {(control) => (
              <input
                {...control}
                className="bf-input mono gov-safety__command"
                data-testid="safety-command"
                value={command}
                maxLength={2000}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setCommand(event.target.value);
                  setActivePreset(null);
                }}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            icon={<Terminal size={15} />}
            loading={evaluate.isPending}
            disabled={!command.trim()}
            data-testid="safety-evaluate"
          >
            Evaluate
          </Button>
        </form>

        <div>
          <h3 className="micro gov-safety__presets-title">Try an example</h3>
          <ul className="gov-presets">
            {PRESETS.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  className={cx('gov-preset', activePreset === preset.id && 'gov-preset--active')}
                  data-kind={preset.kind}
                  data-testid={`safety-preset-${preset.id}`}
                  aria-pressed={activePreset === preset.id}
                  disabled={evaluate.isPending}
                  onClick={() => {
                    run(preset.command, preset.id);
                  }}
                >
                  <span className="gov-preset__top">
                    <span className="gov-preset__label">{preset.label}</span>
                    <Chip
                      size="sm"
                      tone={preset.kind === 'valid' ? 'jade' : 'crimson'}
                      variant="outline"
                    >
                      {KIND_LABEL[preset.kind]}
                    </Chip>
                  </span>
                  <code className="gov-preset__cmd">{preset.command}</code>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="gov-safety__result" aria-live="polite">
        {evaluate.isError ? (
          <ErrorState
            title={
              evaluate.error instanceof ApiError && evaluate.error.status === 403
                ? 'Not permitted'
                : 'Evaluation failed'
            }
            error={evaluate.error}
            onRetry={() => {
              evaluate.mutate(command);
            }}
          />
        ) : result ? (
          <Panel
            title="Verdict"
            subtitle="Three stages, in order. The first failure is where the command stops."
            actions={
              <Chip tone="ash" variant="outline" dashed size="sm" mono>
                executed: {String(result.executed)}
              </Chip>
            }
          >
            <div className="gov-verdict" data-verdict={result.verdict}>
              {result.verdict === 'would_run' ? (
                <ShieldCheck size={22} aria-hidden="true" />
              ) : (
                <ShieldX size={22} aria-hidden="true" />
              )}
              <div>
                <p className="gov-verdict__word">
                  {result.verdict === 'would_run' ? 'Would run' : 'Blocked'}
                </p>
                <p className="gov-verdict__input mono">{result.input}</p>
              </div>
            </div>
            <ol className="gov-stages">
              {stagesOf(result).map((stage, index) => (
                <li
                  key={stage.id}
                  className="gov-stage"
                  data-state={stage.state}
                  data-blocked={stage.blockedHere || undefined}
                >
                  <span className="gov-stage__icon">{STAGE_ICON[stage.state]}</span>
                  <div className="gov-stage__body">
                    <p className="gov-stage__head">
                      <span className="micro">Stage {index + 1}</span>
                      <strong>{stage.label}</strong>
                      <span className="gov-stage__state">
                        {STAGE_WORD[stage.state]}
                        {stage.blockedHere ? ' · stopped here' : ''}
                      </span>
                    </p>
                    <p className="gov-stage__question">{stage.question}</p>
                    {stage.rule ? <p className="gov-stage__rule mono">{stage.rule}</p> : null}
                    {stage.reason ? <p className="gov-stage__reason">{stage.reason}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
            {result.allowlist.destructive ? (
              <p className="gov-destructive">
                <Ban size={14} aria-hidden="true" /> Matches a destructive pattern. Blocked
                regardless of any permission.
              </p>
            ) : null}
            <p className="gov-explanation">{result.explanation}</p>
            <p className="gov-executed">
              <strong>executed: false.</strong> This playground evaluates policy only. No process
              was started.
            </p>
          </Panel>
        ) : (
          <EmptyState
            icon={<Terminal size={18} />}
            title="No command evaluated yet"
            description="Pick an example or type a command, then evaluate it. You will see which stage stops it and why."
          />
        )}
      </div>
    </div>
  );
}
