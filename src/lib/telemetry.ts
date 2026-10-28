/* Traces for IBM watsonx Orchestrate (Agent Analytics), sent over OTLP/HTTP when configured. Each specialist's
 * work in a run is its own trace, with that specialist's Orchestrate Agent ID on the root span, so Orchestrate
 * shows each agent's runs, latency and token use separately. All spans of one run share a session id.
 *
 * Settings (Hostinger environment variables; nothing here is needed for the app to work):
 *   ORCHESTRATE_INSTANCE_URL  https://api.<region>.watson-orchestrate.cloud.ibm.com/instances/<instance-id>
 *   ORCHESTRATE_API_KEY       API key for that instance
 *   ORCHESTRATE_TENANT_ID     <account-id>_<instance-id>
 *   ORCHESTRATE_AGENT_IDS     coordinator=<id>,reader=<id>,research=<id>,classify=<id>,controls=<id>,docs=<id>,conformity=<id>,checker=<id>
 *   ORCHESTRATE_AUTH          iam (IBM Cloud, the default for *.cloud.ibm.com) | mcsp (AWS) | apikey (legacy x-api-key)
 *   ORCHESTRATE_ENV           live (default) or draft
 *   ORCHESTRATE_OTEL_URL      only to override the ingestion URL; ORCHESTRATE_TOKEN_URL to override the token URL */
import { context, trace, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { TracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { orchestrateIds, crewName, type CrewKey } from './agent/specialists';
import type { Tokens } from './agent/pricing';

const instance = () => (process.env.ORCHESTRATE_INSTANCE_URL || '').replace(/\/$/, '');
export const tracingOn = () => !!((process.env.ORCHESTRATE_OTEL_URL || instance()) && process.env.ORCHESTRATE_API_KEY);
const endpoint = () => process.env.ORCHESTRATE_OTEL_URL || `${instance()}/v1/orchestrate/inject/traces`;

let token: { value: string; until: number } | null = null;

async function authHeaders(): Promise<Record<string, string>> {
  const key = process.env.ORCHESTRATE_API_KEY || '';
  const mode = (process.env.ORCHESTRATE_AUTH || (/cloud\.ibm\.com/.test(instance()) ? 'iam' : 'mcsp')).toLowerCase();
  if (mode === 'apikey') return { 'x-api-key': key };
  if (token && token.until > Date.now() + 60e3) return { Authorization: `Bearer ${token.value}` };
  const r = mode === 'iam'
    ? await fetch(process.env.ORCHESTRATE_TOKEN_URL || 'https://iam.cloud.ibm.com/identity/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'urn:ibm:params:oauth:grant-type:apikey', apikey: key }),
    })
    : await fetch(process.env.ORCHESTRATE_TOKEN_URL || 'https://iam.platform.saas.ibm.com/siusermgr/api/1.0/apikeys/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ apikey: key }),
    });
  if (!r.ok) throw new Error(`Orchestrate token request failed (${r.status})`);
  const b = await r.json() as { access_token?: string; token?: string; expires_in?: number };
  const value = b.access_token || b.token;
  if (!value) throw new Error('Orchestrate token response had no token');
  token = { value, until: Date.now() + (b.expires_in || 3600) * 1000 };
  return { Authorization: `Bearer ${value}` };
}

const clip = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** One specialist's work in a run: a root span carrying its Orchestrate Agent ID, with model and tool calls below. */
export class AgentSpan {
  constructor(private tracer: Tracer | null, private root: Span | null, readonly key: CrewKey) {}
  private ctx() { return this.root ? trace.setSpan(context.active(), this.root) : context.active(); }

  llm(model: string, t: Tokens, costUsd: number, start: number, end: number, stop?: string | null) {
    if (!this.tracer) return;
    try {
      const usage = { input: t.input, output: t.output, cache_read_input_tokens: t.cacheRead, cache_creation_input_tokens: t.cacheWrite };
      this.tracer.startSpan(`${crewName(this.key)}: ${model}`, {
        startTime: start,
        attributes: {
          'operation.type': 'llm', 'gen_ai.system': 'anthropic', 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': model, 'gen_ai.response.model': model,
          'gen_ai.usage.input_tokens': t.input + t.cacheRead + t.cacheWrite, 'gen_ai.usage.output_tokens': t.output,
          'gen_ai.usage.cache_read.input_tokens': t.cacheRead, 'gen_ai.usage.cache_creation.input_tokens': t.cacheWrite,
          'gen_ai.response.finish_reasons': stop ? [stop] : [],
          'langfuse.observation.type': 'generation', 'langfuse.observation.model.name': model,
          'langfuse.observation.usage_details': JSON.stringify(usage), 'langfuse.observation.cost_details': JSON.stringify({ total: Number(costUsd.toFixed(6)) }),
          'ituti.cost_usd_estimate': Number(costUsd.toFixed(6)),
        },
      }, this.ctx()).end(end);
    } catch (e) { console.error('[otel] span failed', e); }
  }

  tool(name: string, start: number, end: number, ok: boolean, detail = '') {
    if (!this.tracer) return;
    try {
      const s = this.tracer.startSpan(`tool ${name}`, { startTime: start, attributes: { 'operation.type': 'tool', 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, 'langfuse.observation.type': 'tool', input: clip(detail, 500) } }, this.ctx());
      if (!ok) s.setStatus({ code: SpanStatusCode.ERROR, message: clip(detail, 200) });
      s.end(end);
    } catch (e) { console.error('[otel] span failed', e); }
  }

  end(output: string, ok = true) {
    if (!this.root) return;
    try {
      this.root.setAttribute('output', clip(output));
      if (!ok) this.root.setStatus({ code: SpanStatusCode.ERROR, message: clip(output, 200) });
      this.root.end();
    } catch (e) { console.error('[otel] span failed', e); }
    this.root = null;
  }
}

/** Tracing for one run or one A2A request. Without settings it does nothing, at no cost. */
export class RunTrace {
  private constructor(private provider: TracerProvider | null, private tracer: Tracer | null, readonly sessionId: string, private userId: string, private systemName: string) {}

  static async start(opts: { sessionId: string; userId: string | null; orgId: string; systemName: string }): Promise<RunTrace> {
    const user = `usr_${opts.userId || `org_${opts.orgId}`}`;
    if (!tracingOn()) return new RunTrace(null, null, opts.sessionId, user, opts.systemName);
    try {
      const headers = await authHeaders();
      const provider = new TracerProvider({
        resource: resourceFromAttributes({
          'service.name': 'ituti-ai-assurance', 'service.version': '1.0.0', application: 'ituti-ai-assurance',
          'tenant.id': process.env.ORCHESTRATE_TENANT_ID || '', 'deployment.environment': process.env.ORCHESTRATE_ENV || 'live',
        }),
        spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: endpoint(), headers, timeoutMillis: 15000 }), scheduledDelayMillis: 5000 })],
      });
      return new RunTrace(provider, provider.getTracer('ituti-ai-assurance'), opts.sessionId, user, opts.systemName);
    } catch (e) {
      console.error('[otel] tracing disabled for this run:', e instanceof Error ? e.message : e);
      return new RunTrace(null, null, opts.sessionId, user, opts.systemName);
    }
  }

  /** Starts a specialist's root span, in a trace of its own. */
  agent(key: CrewKey, input: string): AgentSpan {
    if (!this.tracer) return new AgentSpan(null, null, key);
    try {
      const root = this.tracer.startSpan(`${crewName(key)}: ${this.systemName}`, {
        root: true,
        attributes: {
          'agent.id': orchestrateIds()[key] || '', 'agent.name': crewName(key), 'langfuse.session.id': this.sessionId, 'langfuse.user.id': this.userId,
          'langfuse.trace.name': crewName(key), 'operation.type': 'agent', 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': crewName(key), input: clip(input),
        },
      });
      return new AgentSpan(this.tracer, root, key);
    } catch (e) { console.error('[otel] span failed', e); return new AgentSpan(null, null, key); }
  }

  async end() {
    if (!this.provider) return;
    try { await this.provider.forceFlush(); await this.provider.shutdown(); }
    catch (e) { console.error('[otel] export failed', e instanceof Error ? e.message : e); }
  }
}
