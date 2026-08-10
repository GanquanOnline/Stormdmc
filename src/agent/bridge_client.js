export class BridgeClient {
    constructor(options = {}) {
        this.port = options.port || window.SNOWSTORM_MCP_PORT || 43123;
        this.path = options.path || '/snowstorm';
        this.socket = null;
        this.sessionId = null;
        this.revision = 0;
        this.connected = false;
        this.listeners = {};
        this.requests = new Map();
        this.retry = 500;
        this.closed = false;
    }
    on(type, callback) {
        (this.listeners[type] ||= []).push(callback);
        return () => this.listeners[type] = (this.listeners[type] || []).filter(item => item !== callback);
    }
    emit(type, value) {
        (this.listeners[type] || []).forEach(callback => callback(value));
    }
    connect() {
        if (this.closed || this.socket || typeof WebSocket === 'undefined') return;
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        try {
            this.socket = new WebSocket(`${protocol}://127.0.0.1:${this.port}${this.path}`);
            this.socket.onopen = () => {
                this.retry = 500;
                this.socket.send(JSON.stringify({protocolVersion: 1, type: 'hello', revision: this.revision, payload: {client: 'snowstorm-browser', version: typeof VERSION === 'undefined' ? 'dev' : VERSION}}));
                this.emit('status', {connected: false, connecting: true});
            };
            this.socket.onmessage = event => this.handleMessage(event.data);
            this.socket.onerror = () => {};
            this.socket.onclose = () => {
                this.socket = null;
                this.sessionId = null;
                this.connected = false;
                for (const request of this.requests.values()) request.reject(new Error('Bridge disconnected'));
                this.requests.clear();
                this.emit('status', {connected: false});
                if (!this.closed) {
                    const wait = this.retry;
                    this.retry = Math.min(8000, this.retry * 2);
                    setTimeout(() => this.connect(), wait);
                }
            };
        } catch (error) {
            this.emit('error', error);
        }
    }
    close() {
        this.closed = true;
        this.socket?.close();
    }
    request(command, args = {}, revision = this.revision) {
        if (!this.socket || !this.connected) return Promise.reject(new Error('Bridge is not connected'));
        const requestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        this.socket.send(JSON.stringify({protocolVersion: 1, sessionId: this.sessionId, requestId, revision, type: 'command_request', payload: {command, args}}));
        return new Promise((resolve, reject) => this.requests.set(requestId, {resolve, reject}));
    }
    send(type, payload) {
        if (!this.socket || !this.connected) return false;
        this.socket.send(JSON.stringify({protocolVersion: 1, sessionId: this.sessionId, revision: this.revision, type, payload}));
        return true;
    }
    handleMessage(raw) {
        let message;
        try { message = JSON.parse(raw); } catch { return; }
        if (message.revision !== undefined) this.revision = message.revision;
        if (message.type === 'hello_ack') {
            this.sessionId = message.sessionId;
            this.connected = true;
            this.emit('status', {connected: true, sessionId: this.sessionId, workspace: message.payload?.workspace || null, exportOnly: !!message.payload?.exportOnly});
        } else if (message.type === 'command_result' && message.requestId) {
            const request = this.requests.get(message.requestId);
            if (!request) return;
            this.requests.delete(message.requestId);
            message.payload?.ok === false ? request.reject(Object.assign(new Error(message.payload.error?.message || 'Command failed'), message.payload.error || {})) : request.resolve(message.payload?.result);
        } else if (message.type === 'approval_result') {
            this.emit('approval_result', message.payload);
        } else if (message.type === 'error') {
            this.emit('error', message.payload);
        }
    }
}
