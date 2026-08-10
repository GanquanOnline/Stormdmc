import type { WebSocket } from 'ws';

export type BridgeMessage = {
  protocolVersion: 1;
  sessionId?: string;
  requestId?: string;
  revision?: number;
  type: string;
  payload?: any;
};

export type AgentSnapshot = {
  sessionId?: string;
  revision: number;
  connected: boolean;
  document: {
    path: string | null;
    identifier: string | null;
    dirty: boolean;
  };
  storage?: {
    mode: 'workspace' | 'browser_export';
    workspace: string | null;
  };
  particle: any;
  texture: {
    path: string | null;
    dirty: boolean;
    width?: number;
    height?: number;
    hasData: boolean;
  };
  preview: Record<string, any>;
  capabilities: string[];
  inputSchema?: Array<Record<string, any>>;
};

export type PendingChange = {
  id: string;
  sessionId: string;
  baseRevision: number;
  revision: number;
  status: 'pending_confirmation' | 'approved' | 'saved' | 'exported' | 'discarded' | 'failed';
  documentPath: string | null;
  diff: Array<{ path: string; before: unknown; after: unknown }>;
  warnings: Array<{ text: string; severity?: string }>;
  before: { particle: any; texture?: AgentTextureArtifact };
  after: { particle: any; texture?: AgentTextureArtifact };
};

export type AgentTextureArtifact = {
  path: string | null;
  dataUrl: string | null;
  width?: number;
  height?: number;
};

export type BridgeSession = {
  id: string;
  socket: WebSocket;
  revision: number;
  snapshot: AgentSnapshot | null;
};
