import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocketServer, type WebSocket, type VerifyClientCallbackSync } from 'ws';
import type { AgentSnapshot, BridgeMessage, BridgeSession, PendingChange } from './protocol.js';
import { Workspace } from './workspace.js';

type PendingRequest = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class BridgeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export class BridgeServer extends EventEmitter {
  private server?: WebSocketServer;
  private active?: BridgeSession;
  private controllers = new Set<WebSocket>();
  private controllerRequests = new Map<string, WebSocket>();
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingChanges = new Map<string, PendingChange>();

  constructor(public readonly workspace: Workspace | undefined, public readonly port = 43123) {
    super();
  }

  start(): void {
    this.server = new WebSocketServer({
      host: '127.0.0.1',
      port: this.port,
      path: '/snowstorm',
      verifyClient: ((info) => {
        const origin = info.origin;
        if (!origin) return true;
        try {
          const url = new URL(origin);
          return url.protocol === 'file:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
        } catch {
          return false;
        }
      }) satisfies VerifyClientCallbackSync
    });
    this.server.on('connection', socket => this.handleConnection(socket));
    this.server.on('listening', () => console.error(`Snowstorm Bridge listening on 127.0.0.1:${this.port}`));
    this.server.on('error', error => console.error('Snowstorm Bridge error:', error.message));
  }

  async stop(): Promise<void> {
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timer);
      request.reject(new BridgeError('BRIDGE_OFFLINE', 'Bridge stopped'));
    }
    this.pendingRequests.clear();
    this.active?.socket.close();
    for (const controller of this.controllers) controller.close();
    this.controllers.clear();
    this.controllerRequests.clear();
    await new Promise<void>(resolve => this.server?.close(() => resolve()) ?? resolve());
  }

  getSession(): BridgeSession | undefined {
    return this.active;
  }

  getPending(id?: string): PendingChange | PendingChange[] | null {
    if (id) return this.pendingChanges.get(id) || null;
    return [...this.pendingChanges.values()];
  }

  async request(command: string, args: any = {}, expectedRevision?: number): Promise<any> {
    const session = this.active;
    if (!session || session.socket.readyState !== 1) throw new BridgeError('NO_SESSION', 'No Snowstorm browser session is connected');
    if (expectedRevision !== undefined && session.revision !== expectedRevision) {
      throw new BridgeError('STALE_REVISION', `Expected revision ${expectedRevision}, current revision is ${session.revision}`);
    }
    const requestId = randomUUID();
    const message: BridgeMessage = {
      protocolVersion: 1,
      sessionId: session.id,
      requestId,
      revision: expectedRevision ?? session.revision,
      type: 'command_request',
      payload: { command, args }
    };
    session.socket.send(JSON.stringify(message));
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new BridgeError('BRIDGE_OFFLINE', `Timed out waiting for ${command}`));
      }, 30_000);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
    });
  }

  private handleConnection(socket: WebSocket): void {
    let handshakeComplete = false;
    let controller = false;
    const handshakeTimer = setTimeout(() => {
      if (!handshakeComplete) socket.close(1008, 'hello required');
    }, 5_000);

    socket.on('message', raw => {
      let message: BridgeMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(1003, 'invalid JSON');
        return;
      }
      if (message.protocolVersion !== 1) {
        socket.close(1002, 'unsupported protocol');
        return;
      }
      if (message.type === 'hello') {
        if (message.payload?.client === 'snowstorm-mcp-exe') {
          clearTimeout(handshakeTimer);
          handshakeComplete = true;
          controller = true;
          this.controllers.add(socket);
          socket.send(JSON.stringify({ protocolVersion: 1, sessionId: randomUUID(), revision: this.active?.revision || 0, type: 'hello_ack', payload: { port: this.port, workspace: this.workspace?.root || null, exportOnly: !this.workspace, controller: true } }));
          if (this.active?.snapshot) this.sendTo(socket, 'state_changed', {snapshot: this.active.snapshot});
          for (const pending of this.pendingChanges.values()) this.sendTo(socket, 'approval_required', {pending});
          return;
        }
        if (this.active && this.active.socket.readyState === 1) {
          socket.send(JSON.stringify({ protocolVersion: 1, type: 'error', payload: { code: 'SESSION_BUSY', message: 'Another Snowstorm page is already connected' } }));
          socket.close(1013, 'session busy');
          return;
        }
        clearTimeout(handshakeTimer);
        handshakeComplete = true;
        const sessionId = randomUUID();
        this.active = { id: sessionId, socket, revision: Number(message.revision || 0), snapshot: null };
        socket.send(JSON.stringify({ protocolVersion: 1, sessionId, revision: this.active.revision, type: 'hello_ack', payload: { port: this.port, workspace: this.workspace?.root || null, exportOnly: !this.workspace } }));
        this.emit('connected', this.active);
        return;
      }
      if (!handshakeComplete) return;
      if (controller) {
        this.handleControllerMessage(socket, message);
        return;
      }
      if (!this.active) return;
      this.handleMessage(message);
    });

    socket.on('close', () => {
      clearTimeout(handshakeTimer);
      if (controller) {
        this.controllers.delete(socket);
        for (const [requestId, owner] of this.controllerRequests) {
          if (owner === socket) this.controllerRequests.delete(requestId);
        }
        return;
      }
      if (this.active?.socket === socket) {
        for (const request of this.pendingRequests.values()) {
          clearTimeout(request.timer);
          request.reject(new BridgeError('BRIDGE_OFFLINE', 'Snowstorm browser session disconnected'));
        }
        this.pendingRequests.clear();
        this.active = undefined;
        for (const controller of this.controllers) {
          if (controller.readyState === 1) this.sendTo(controller, 'error', {code: 'NO_SESSION', message: 'Snowstorm editor window disconnected'});
        }
        this.emit('disconnected');
      }
    });
  }

  private handleMessage(message: BridgeMessage): void {
    if (!this.active) return;
    if (message.sessionId && message.sessionId !== this.active.id) return;
    if (message.revision !== undefined) this.active.revision = message.revision;
    if (message.type === 'command_result' && message.requestId) {
      const controller = this.controllerRequests.get(message.requestId);
      if (controller) {
        this.controllerRequests.delete(message.requestId);
        if (controller.readyState === 1) controller.send(JSON.stringify(message));
        return;
      }
      const request = this.pendingRequests.get(message.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      this.pendingRequests.delete(message.requestId);
      if (message.payload?.ok === false) request.reject(new BridgeError(message.payload.error?.code || 'INVALID_ACTION', message.payload.error?.message || 'Command failed'));
      else request.resolve(message.payload?.result);
    } else if (message.type === 'state_changed') {
      this.active.snapshot = message.payload?.snapshot || null;
      this.broadcastControllers(message);
      this.emit('state', this.active.snapshot);
    } else if (message.type === 'approval_required') {
      const pending = message.payload?.pending as PendingChange;
      if (pending?.id) this.pendingChanges.set(pending.id, pending);
      this.broadcastControllers(message);
      this.emit('pending', pending);
    } else if (message.type === 'approval_result') {
      void this.handleApproval(message.payload);
    }
  }

  private handleControllerMessage(socket: WebSocket, message: BridgeMessage): void {
    if (message.type !== 'command_request' || !message.requestId) return;
    if (!this.active || this.active.socket.readyState !== 1) {
      this.sendTo(socket, 'command_result', {ok: false, error: {code: 'NO_SESSION', message: 'No Snowstorm editor window is connected'}}, message.requestId);
      return;
    }
    if (message.revision !== undefined && message.revision !== this.active.revision && !['get_state', 'open_document'].includes(message.payload?.command)) {
      this.sendTo(socket, 'command_result', {ok: false, error: {code: 'STALE_REVISION', message: `Expected revision ${message.revision}, current revision is ${this.active.revision}`}}, message.requestId);
      return;
    }
    this.controllerRequests.set(message.requestId, socket);
    this.active.socket.send(JSON.stringify({...message, sessionId: this.active.id, revision: message.revision ?? this.active.revision}));
  }

  private sendTo(socket: WebSocket, type: string, payload: any, requestId?: string): void {
    socket.send(JSON.stringify({protocolVersion: 1, sessionId: this.active?.id, requestId, revision: this.active?.revision || 0, type, payload}));
  }

  private broadcastControllers(message: BridgeMessage): void {
    const raw = JSON.stringify(message);
    for (const controller of this.controllers) {
      if (controller.readyState === 1) controller.send(raw);
    }
  }

  private async handleApproval(payload: any): Promise<void> {
    const pending = payload?.pendingId ? this.pendingChanges.get(payload.pendingId) : undefined;
    if (!pending) return;
    if (payload.status === 'approved') {
      try {
        const artifact = payload.artifact || pending.after;
        if (!this.workspace) {
          pending.status = 'failed';
          pending.warnings.push({ text: 'No workspace is configured; export from the Snowstorm page instead', severity: 'error' });
        } else {
          if (artifact.particle && pending.documentPath) await this.workspace.writeParticle(pending.documentPath, artifact.particle);
          if (artifact.texture?.dataUrl && artifact.texture.path) await this.workspace.writeTexture(artifact.texture.path, artifact.texture.dataUrl);
          pending.status = 'saved';
        }
      } catch (error: any) {
        pending.status = 'failed';
        pending.warnings.push({ text: error?.message || 'Failed to save changes', severity: 'error' });
      }
    } else if (payload.status === 'exported') {
      pending.status = 'exported';
    } else {
      pending.status = 'discarded';
    }
    if (this.active?.socket.readyState === 1) {
      this.active.socket.send(JSON.stringify({
        protocolVersion: 1,
        sessionId: this.active.id,
        revision: this.active.revision,
        type: 'approval_result',
        payload: { pendingId: pending.id, status: pending.status, warnings: pending.warnings }
      }));
    }
    this.broadcastControllers({ protocolVersion: 1, sessionId: this.active?.id, revision: this.active?.revision || 0, type: 'approval_result', payload: { pendingId: pending.id, status: pending.status, warnings: pending.warnings } });
    if (pending.status === 'saved' || pending.status === 'exported' || pending.status === 'discarded') this.pendingChanges.delete(pending.id);
    this.emit('approval', pending);
  }
}
