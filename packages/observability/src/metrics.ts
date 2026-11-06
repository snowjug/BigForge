type Labels = Record<string, string>;

const esc = (v: string) =>
  v.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
const fmt = (labels: Labels) => {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};
const key = (labels: Labels) =>
  JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));

abstract class Metric {
  readonly name: string;
  readonly help: string;
  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }
  abstract render(): string[];
}

export class Counter extends Metric {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  inc(labels: Labels = {}, by = 1): void {
    const k = key(labels);
    const cur = this.values.get(k);
    if (cur) cur.value += by;
    else this.values.set(k, { labels, value: by });
  }
  render(): string[] {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      ...[...this.values.values()].map((v) => `${this.name}${fmt(v.labels)} ${v.value}`),
    ];
  }
}

export class Gauge extends Metric {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  set(value: number, labels: Labels = {}): void {
    this.values.set(key(labels), { labels, value });
  }
  render(): string[] {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      ...[...this.values.values()].map((v) => `${this.name}${fmt(v.labels)} ${v.value}`),
    ];
  }
}

export class Histogram extends Metric {
  private readonly buckets: number[];
  private readonly series = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();
  constructor(name: string, help: string, buckets: number[]) {
    super(name, help);
    this.buckets = [...buckets].sort((a, b) => a - b);
  }
  observe(value: number, labels: Labels = {}): void {
    const k = key(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    this.buckets.forEach((b, i) => {
      if (value <= b) s.counts[i] = (s.counts[i] ?? 0) + 1;
    });
    s.sum += value;
    s.count += 1;
  }
  render(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const s of this.series.values()) {
      this.buckets.forEach((b, i) =>
        out.push(`${this.name}_bucket${fmt({ ...s.labels, le: String(b) })} ${s.counts[i] ?? 0}`),
      );
      out.push(
        `${this.name}_bucket${fmt({ ...s.labels, le: '+Inf' })} ${s.count}`,
        `${this.name}_sum${fmt(s.labels)} ${s.sum}`,
        `${this.name}_count${fmt(s.labels)} ${s.count}`,
      );
    }
    return out;
  }
}

/** In-process metrics registry rendering Prometheus text exposition. No labels may carry secrets or user content. */
export class MetricsRegistry {
  private readonly metrics: Metric[] = [];

  counter(name: string, help: string): Counter {
    const m = new Counter(name, help);
    this.metrics.push(m);
    return m;
  }
  gauge(name: string, help: string): Gauge {
    const m = new Gauge(name, help);
    this.metrics.push(m);
    return m;
  }
  histogram(name: string, help: string, buckets: number[]): Histogram {
    const m = new Histogram(name, help, buckets);
    this.metrics.push(m);
    return m;
  }
  render(): string {
    return `${this.metrics.flatMap((m) => m.render()).join('\n')}\n`;
  }
}

export interface BigForgeMetrics {
  registry: MetricsRegistry;
  httpRequests: Counter;
  httpDuration: Histogram;
  runs: Counter;
  modelCalls: Counter;
  tokens: Counter;
  firewallVerdicts: Counter;
  transitions: Counter;
  jobs: Counter;
}

export function createMetrics(): BigForgeMetrics {
  const registry = new MetricsRegistry();
  return {
    registry,
    httpRequests: registry.counter(
      'bigforge_http_requests_total',
      'HTTP requests by method, route class and status',
    ),
    httpDuration: registry.histogram(
      'bigforge_http_request_duration_seconds',
      'HTTP request duration',
      [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60],
    ),
    runs: registry.counter('bigforge_runs_total', 'Task runs by kind and outcome'),
    modelCalls: registry.counter(
      'bigforge_model_calls_total',
      'Model calls by provider mode (deterministic calls are synthetic, not live calls)',
    ),
    tokens: registry.counter(
      'bigforge_tokens_total',
      'Tokens by type and provenance (synthetic, measured, estimated)',
    ),
    firewallVerdicts: registry.counter(
      'bigforge_firewall_verdicts_total',
      'Token Firewall final verdicts',
    ),
    transitions: registry.counter(
      'bigforge_reflex_transitions_total',
      'Reflex lifecycle transitions',
    ),
    jobs: registry.counter('bigforge_jobs_total', 'Background jobs by type and final status'),
  };
}
