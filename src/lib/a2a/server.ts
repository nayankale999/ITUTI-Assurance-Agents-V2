import { DefaultRequestHandler, JsonRpcTransportHandler } from '@a2a-js/sdk/server';
import { agentCard } from './card';
import { DbTaskStore } from './store';
import { AssuranceExecutor } from './assistant';

const g = globalThis as unknown as { __a2a?: JsonRpcTransportHandler };

export function transport() {
  return (g.__a2a ??= new JsonRpcTransportHandler(new DefaultRequestHandler(agentCard(), new DbTaskStore(), new AssuranceExecutor())));
}
