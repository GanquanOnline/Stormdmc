import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { BridgeError } from './bridge.js';

type PendingRequest = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** MCP-side client used when the desktop editor already owns the local Bridge port. */
export class RemoteBridge extends EventEmitter {
  private socket?: WebSocket;
  private session?: { id: string; revision: number; snapshot: any; socket: WebSocket };
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingChanges = new Map<string, any>();

  constructor(public readonly port = 43123) {
    super();
  }

  async connect(timeout = 15_000): Promise<void> {
    if (this.socket) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new BridgeError('BRIDGE_OFFLINE', 'Timed out connecting to the Snowstorm desktop app'));
      }, timeout);
      const socket = new WebSocket(`ws://127.0.0.1:${this.port}/snowstorm`, {origin: 'http://127.0.0.1'});
      this.socket = socket;
      socket.on('open', () => socket.send(JSON.stringify({protocolVersion: 1, type: 'hello', revision: 0, payload: {client: 'snowstorm-mcp-exe'}})));
      socket.on('message', raw => {
        let message: any;
        try { message = JSON.parse(raw.toString()); } catch { return; }
        if (message.type === 'hello_ack') {
          this.session = {id: message.sessionId, revision: Number(message.revision || 0), snapshot: null, socket};
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
          return;
        }
        this.handleMessage(message);
      });
      socket.on('error', error => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new BridgeError('BRIDGE_OFFLINE', error.message));
        }
      });
      socket.on('close', () => {
        if (this.socket === socket) this.socket = undefined;
        for (const request of this.pendingRequests.values()) {
          clearTimeout(request.timer);
          request.reject(new BridgeError('BRIDGE_OFFLINE', 'Snowstorm desktop app disconnected'));
        }
        this.pendingRequests.clear();
        this.session = undefined;
        this.emit('disconnected');
      });
    });
  }

  async stop(): Promise<void> {
    this.socket?.close();
    this.socket = undefined;
  }

  getSession(): any {
    return this.session;
  }

  getPending(id?: string): any {
    if (id) return this.pendingChanges.get(id) || null;
    return [...this.pendingChanges.values()];
  }

  async request(command: string, args: any = {}, expectedRevision?: number): Promise<any> {
    if (!this.socket || !this.session || this.socket.readyState !== WebSocket.OPEN) {
      throw new BridgeError('BRIDGE_OFFLINE', 'Snowstorm desktop app is not connected');
    }
    if (expectedRevision !== undefined && this.session.revision !== expectedRevision) {
      throw new BridgeError('STALE_REVISION', `Expected revision ${expectedRevision}, current revision is ${this.session.revision}`);
    }
    const requestId = randomUUID();
    this.socket.send(JSON.stringify({protocolVersion: 1, sessionId: this.session.id, requestId, revision: expectedRevision ?? this.session.revision, type: 'command_request', payload: {command, args}}));
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new BridgeError('BRIDGE_OFFLINE', `Timed out waiting for ${command}`));
      }, 30_000);
      this.pendingRequests.set(requestId, {resolve, reject, timer});
    });
  }

  private handleMessage(message: any): void {
    if (!this.session) return;
    if (message.revision !== undefined) this.session.revision = Number(message.revision);
    if (message.type === 'command_result' && message.requestId) {
      const request = this.pendingRequests.get(message.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      this.pendingRequests.delete(message.requestId);
      if (message.payload?.ok === false) request.reject(new BridgeError(message.payload.error?.code || 'INVALID_ACTION', message.payload.error?.message || 'Command failed'));
      else request.resolve(message.payload?.result);
    } else if (message.type === 'state_changed') {
      this.session.snapshot = message.payload?.snapshot || null;
      this.emit('state', this.session.snapshot);
    } else if (message.type === 'approval_required') {
      const pending = message.payload?.pending;
      if (pending?.id) this.pendingChanges.set(pending.id, pending);
      this.emit('pending', pending);
    } else if (message.type === 'approval_result') {
      const pending = message.payload?.pendingId ? this.pendingChanges.get(message.payload.pendingId) : undefined;
      if (pending) pending.status = message.payload.status;
      if (['saved', 'exported', 'discarded'].includes(message.payload?.status)) this.pendingChanges.delete(message.payload.pendingId);
      this.emit('approval', message.payload);
    }
  }
}
