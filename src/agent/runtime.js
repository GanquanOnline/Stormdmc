import Vue from 'vue';
import Data, {forEachInput} from '../input_structure';
import {Config, Emitter} from '../emitter';
import {generateFile} from '../export';
import {loadFile, loadPreset, startNewProject} from '../import';
import {Texture} from '../texture_edit';
import {View} from '../components/Preview';
import {validate} from '../components/WarningDialog';
import Curve from '../curves';
import registerEdit from '../edits';
import vscode from '../vscode_extension';
import {guid, bbuid, compileJSON, IO, pathToName} from '../util';
import {clone, stableDiff, hashString} from './diff';
import {generateTexture} from './texture_generator';
import {BridgeClient} from './bridge_client';
import {TGALoader} from 'three/examples/jsm/loaders/TGALoader.js';

const capabilities = [
    'set_input', 'load_preset', 'add_curve', 'update_curve', 'remove_curve',
    'add_event', 'update_event', 'remove_event', 'set_gradient', 'import_texture',
    'generate_texture', 'set_uv', 'preview_control', 'set_active_tab'
];
const publicActionTypes = new Set(capabilities);

const inputById = {};
forEachInput(input => { if (input.id) inputById[input.id] = input; });
const inputSchema = Object.values(inputById).map(input => ({
    id: input.id,
    label: input.label || input.id,
    type: input.type,
    axisCount: input.axis_count,
    required: !!input.required,
    options: input.options ? Object.keys(input.options) : undefined,
    min: input.min,
    max: input.max
})).sort((a, b) => a.id.localeCompare(b.id));

function normalizeColor(color) {
    let value = String(color || '#ffffffff').trim();
    if (!value.startsWith('#')) value = `#${value}`;
    if (value.length === 4) value = '#' + [...value.slice(1)].map(char => char + char).join('') + 'ff';
    if (value.length === 7) value += 'ff';
    return /^#[0-9a-f]{8}$/i.test(value) ? value : '#ffffffff';
}

function findInput(id) {
    const input = inputById[id];
    if (!input) throw Object.assign(new Error(`Unknown input id: ${id}`), {code: 'INVALID_ACTION'});
    return input;
}

async function normalizeTextureDataUrl(dataUrl) {
    if (!/^data:image\/tga;base64,/i.test(dataUrl)) return {dataUrl};
    const encoded = dataUrl.replace(/^data:image\/tga;base64,/i, '');
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const parsed = new TGALoader().parse(bytes.buffer);
    const canvas = document.createElement('canvas');
    canvas.width = parsed.width;
    canvas.height = parsed.height;
    const context = canvas.getContext('2d');
    const imageData = context.createImageData(parsed.width, parsed.height);
    imageData.data.set(parsed.data);
    context.putImageData(imageData, 0, 0);
    return {dataUrl: canvas.toDataURL('image/png'), width: parsed.width, height: parsed.height};
}

function configFromObject(object, prefix = '', actions = []) {
    if (!object || typeof object !== 'object') return actions;
    for (const [key, value] of Object.entries(object)) {
        const candidate = prefix ? `${prefix}_${key}` : key;
        if (inputById[candidate]) {
            actions.push({type: 'set_input', id: candidate, value});
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            configFromObject(value, candidate, actions);
        }
    }
    return actions;
}

function createPath(identifier) {
    const name = String(identifier || 'particles').replace(/^\w+:/, '').replace(/[^a-z0-9_.-]+/gi, '_');
    return `particles/${name}.particle.json`;
}

function textureSummary(texture) {
    return {
        path: texture?.path || null,
        width: texture?.width || 0,
        height: texture?.height || 0,
        hasData: !!texture?.dataUrl
    };
}

export class AgentRuntime {
    constructor(app) {
        this.app = app;
        this.client = new BridgeClient();
        this.revision = 0;
        this.documentPath = null;
        this.pending = null;
        this.status = {connected: false};
        this.listeners = {};
        this.executing = false;
        this.editListener = () => this.handleExternalEdit();
        this.client.on('status', status => {
            this.status = status;
            this.emit('status', status);
            if (status.connected) this.publishState();
        });
        this.client.on('approval_result', payload => this.emit('approval_result', payload));
        this.client.on('error', error => this.emit('error', error));
    }

    start() {
        if (vscode) return;
        window.addEventListener('snowstorm-edit', this.editListener);
        this.client.connect();
        const originalHandle = this.client.handleMessage.bind(this.client);
        this.client.handleMessage = raw => {
            let message;
            try { message = JSON.parse(raw); } catch {}
            if (message?.type === 'command_request') {
                this.handleCommand(message);
                return;
            }
            originalHandle(raw);
        };
    }

    stop() {
        window.removeEventListener('snowstorm-edit', this.editListener);
        this.client.close();
    }

    handleExternalEdit() {
        if (this.executing) return;
        this.revision++;
        if (this.pending) {
            this.pending.after = this.captureArtifact();
            this.pending.revision = this.revision;
            this.pending.diff = stableDiff(this.pending.before.particle, this.pending.after.particle);
            this.pending.warnings = validate().map(item => ({...item, severity: 'warning'}));
            this.emit('pending', this.pending);
            this.client.send('approval_required', {pending: this.publicPending(this.pending)});
        }
        this.publishState();
    }

    on(type, callback) {
        (this.listeners[type] ||= []).push(callback);
        return () => this.listeners[type] = (this.listeners[type] || []).filter(item => item !== callback);
    }

    emit(type, value) {
        (this.listeners[type] || []).forEach(callback => callback(value));
    }

    getSnapshot() {
        const particle = generateFile();
        return {
            sessionId: this.client.sessionId,
            revision: this.revision,
            connected: this.client.connected,
            storage: {
                mode: this.status.exportOnly || !this.status.workspace ? 'browser_export' : 'workspace',
                workspace: this.status.workspace || null
            },
            document: {
                path: this.documentPath,
                identifier: Config.identifier || null,
                dirty: !!this.pending
            },
            particle,
            texture: {
                path: Config.particle_texture_path || null,
                dirty: !!Texture.internal_changes,
                width: Texture.canvas.width,
                height: Texture.canvas.height,
                hasData: !!Texture.source
            },
            preview: this.getPreviewState(),
            pending: this.pending ? {id: this.pending.id, status: this.pending.status, diffCount: this.pending.diff.length} : null,
            capabilities,
            inputSchema
        };
    }

    getPreviewState() {
        return {
            paused: !!Emitter.paused,
            loopMode: Emitter.loop_mode,
            parentMode: Emitter.parent_mode,
            collision: !!Emitter.ground_collision,
            age: Emitter.age,
            particleCount: Emitter.particles.length,
            camera: View.camera ? {position: View.camera.position.toArray(), target: View.controls.target.toArray()} : null
        };
    }

    publishState() {
        this.client.revision = this.revision;
        this.client.send('state_changed', {snapshot: this.getSnapshot()});
    }

    async handleCommand(message) {
        const resultMessage = {protocolVersion: 1, sessionId: this.client.sessionId, requestId: message.requestId, revision: this.revision, type: 'command_result'};
        try {
            if (message.revision !== undefined && message.revision !== this.revision && !['get_state', 'open_document'].includes(message.payload?.command)) {
                throw Object.assign(new Error(`Expected revision ${message.revision}, current revision is ${this.revision}`), {code: 'STALE_REVISION'});
            }
            const result = await this.dispatch(message.payload?.command, message.payload?.args || {});
            resultMessage.revision = this.revision;
            resultMessage.payload = {ok: true, result};
        } catch (error) {
            resultMessage.payload = {ok: false, error: {code: error.code || 'INVALID_ACTION', message: error.message || String(error)}};
        }
        this.client.socket?.send(JSON.stringify(resultMessage));
    }

    async dispatch(command, args) {
        switch (command) {
            case 'get_state': return this.getSnapshot();
            case 'open_document': return await this.openDocument(args);
            case 'design_particle': return await this.designParticle(args);
            case 'apply_actions': return await this.executeActions(args.actions || []);
            case 'discard_pending_change': return await this.discardPending(args.id);
            case 'preview': return this.preview(args);
            case 'capture_preview': return {dataUrl: View.captureDataURL(), mimeType: 'image/png', width: View.canvas?.width, height: View.canvas?.height};
            case 'import_texture': return await this.executeActions([{type: 'import_texture', ...args}]);
            case 'generate_texture': return await this.executeActions([{type: 'generate_texture', ...args}]);
            case 'validate_particle': return {warnings: validate().map(item => ({...item, severity: 'warning'}))};
            default: throw Object.assign(new Error(`Unknown command: ${command}`), {code: 'INVALID_ACTION'});
        }
    }

    async openDocument({path, particle}) {
        if (this.pending) await this.discardPending(this.pending.id);
        this.executing = true;
        try {
            loadFile(particle, false);
            this.documentPath = path;
            this.revision++;
            await Vue.nextTick();
            this.publishState();
            return this.getSnapshot();
        } finally {
            this.executing = false;
        }
    }

    async designParticle(spec) {
        const actions = [];
        if (spec.base === 'new') actions.push({type: 'new_particle'});
        else if (spec.base && spec.base !== 'current') actions.push({type: 'load_preset', id: spec.base});
        actions.push({type: 'set_input', id: 'identifier', value: spec.identifier});
        configFromObject(spec.emitter, 'emitter', actions);
        configFromObject(spec.particle, 'particle', actions);
        configFromObject(spec.appearance, 'particle_appearance', actions);
        if (spec.texture?.source === 'procedural') actions.push({type: 'generate_texture', ...spec.texture});
        if (spec.texture?.source === 'existing' && spec.texture.dataUrl) actions.push({type: 'import_texture', ...spec.texture});
        const targetPath = spec.targetPath || this.documentPath || createPath(spec.identifier);
        return await this.executeActions(actions, {documentPath: targetPath, brief: spec.brief, internal: true});
    }

    async executeActions(actions, meta = {}) {
        if (!Array.isArray(actions) || !actions.length || actions.length > 200) throw Object.assign(new Error('Actions must contain between 1 and 200 items'), {code: 'INVALID_ACTION'});
        for (const action of actions) {
            if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
                throw Object.assign(new Error('Every action must have a type'), {code: 'INVALID_ACTION'});
            }
            if (!publicActionTypes.has(action.type) && !(meta.internal && action.type === 'new_particle')) {
                throw Object.assign(new Error(`Unsupported action type: ${action.type}`), {code: 'INVALID_ACTION'});
            }
        }
        if (this.pending) throw Object.assign(new Error('Resolve the current pending change before starting another edit'), {code: 'PENDING_CONFIRMATION'});
        const before = this.captureArtifact();
        const beforePreview = this.getPreviewState();
        const previousPath = this.documentPath;
        this.executing = true;
        try {
            for (const action of actions) await this.applyAction(action);
            await Vue.nextTick();
            Config.updateTexture();
            Emitter.stop(true);
            View.PlaybackController.start();
            const after = this.captureArtifact();
            if (new Blob([JSON.stringify(after.particle)]).size > 2 * 1024 * 1024) {
                throw Object.assign(new Error('Particle file exceeds 2 MB'), {code: 'ASSET_TOO_LARGE'});
            }
            this.revision++;
            this.documentPath = meta.documentPath || this.documentPath || createPath(Config.identifier);
            const pending = {
                id: `${Date.now().toString(36)}-${hashString(JSON.stringify(after.particle))}`,
                sessionId: this.client.sessionId,
                baseRevision: this.revision - 1,
                revision: this.revision,
                status: 'pending_confirmation',
                documentPath: this.documentPath,
                brief: meta.brief || '',
                diff: [...stableDiff(before.particle, after.particle), ...stableDiff(textureSummary(before.texture), textureSummary(after.texture), 'texture')],
                warnings: validate().map(item => ({...item, severity: 'warning'})),
                before,
                after,
                beforePreview,
                previousPath
            };
            this.pending = pending;
            registerEdit('agent edit');
            this.emit('pending', pending);
            this.client.revision = this.revision;
            this.client.send('approval_required', {pending: this.publicPending(pending)});
            this.publishState();
            return this.publicPending(pending);
        } catch (error) {
            await this.restoreArtifact(before);
            this.documentPath = previousPath;
            throw error;
        } finally {
            this.executing = false;
        }
    }

    publicPending(pending) {
        return {
            id: pending.id,
            sessionId: pending.sessionId,
            baseRevision: pending.baseRevision,
            revision: pending.revision,
            status: pending.status,
            documentPath: pending.documentPath,
            brief: pending.brief,
            diff: pending.diff,
            warnings: pending.warnings,
            before: {particle: pending.before.particle, texture: {path: pending.before.texture.path, dataUrl: pending.before.texture.dataUrl, width: pending.before.texture.width, height: pending.before.texture.height, hasData: !!pending.before.texture.dataUrl}},
            after: {particle: pending.after.particle, texture: {path: pending.after.texture.path, dataUrl: pending.after.texture.dataUrl, width: pending.after.texture.width, height: pending.after.texture.height, hasData: !!pending.after.texture.dataUrl}}
        };
    }

    captureArtifact() {
        return {
            particle: clone(generateFile()),
            texture: {
                path: Config.particle_texture_path || null,
                dataUrl: Texture.source || null,
                width: Texture.canvas.width,
                height: Texture.canvas.height
            }
        };
    }

    async restoreArtifact(artifact) {
        loadFile(clone(artifact.particle), false);
        Texture.source = artifact.texture?.dataUrl || '';
        Texture.internal_changes = !!Texture.source;
        await Texture.updateCanvasFromSource();
        Texture.update();
        Config.updateTexture();
        await Vue.nextTick();
    }

    async discardPending(id) {
        if (!this.pending || this.pending.id !== id) throw Object.assign(new Error('Pending change was not found'), {code: 'INVALID_ACTION'});
        const pending = this.pending;
        this.executing = true;
        try {
            await this.restoreArtifact(pending.before);
            this.documentPath = pending.previousPath;
            pending.status = 'discarded';
            this.pending = null;
            this.revision++;
            this.emit('pending', null);
            this.client.send('approval_result', {pendingId: id, status: 'discarded'});
            this.publishState();
            return this.getSnapshot();
        } finally {
            this.executing = false;
        }
    }

    async approvePending(id) {
        if (!this.pending || this.pending.id !== id) throw Object.assign(new Error('Pending change was not found'), {code: 'INVALID_ACTION'});
        if (this.status.exportOnly || !this.status.workspace) return this.exportPending(id);
        const pending = this.pending;
        pending.status = 'approved';
        const completed = new Promise((resolve, reject) => {
            const unsubscribe = this.client.on('approval_result', result => {
                if (result.pendingId !== id) return;
                unsubscribe();
                clearTimeout(timer);
                if (result.status === 'failed') reject(Object.assign(new Error(result.warnings?.slice(-1)[0]?.text || 'Failed to save changes'), {code: 'SAVE_FAILED'}));
                else resolve(result);
            });
            const timer = setTimeout(() => {
                unsubscribe();
                reject(Object.assign(new Error('Timed out waiting for the Bridge to save changes'), {code: 'SAVE_FAILED'}));
            }, 30000);
        });
        this.client.send('approval_result', {pendingId: id, status: 'approved', artifact: pending.after});
        try {
            await completed;
            Texture.markAsSaved();
            this.pending = null;
            this.revision++;
            this.emit('pending', null);
            this.publishState();
            return this.getSnapshot();
        } catch (error) {
            pending.status = 'failed';
            this.emit('pending', pending);
            throw error;
        }
    }

    async exportPending(id) {
        if (!this.pending || this.pending.id !== id) throw Object.assign(new Error('Pending change was not found'), {code: 'INVALID_ACTION'});
        const pending = this.pending;
        const particleName = pathToName(pending.documentPath || createPath(Config.identifier), true).replace(/\.particle\.json$/i, '') || 'particles';
        IO.export({name: `${particleName}.particle.json`, content: compileJSON(pending.after.particle)});
        if (pending.after.texture?.dataUrl) {
            const textureName = pathToName(pending.after.texture.path || particleName, true).replace(/\.(png|tga)$/i, '') || particleName;
            IO.export({name: textureName, extensions: ['png'], savetype: 'image', content: pending.after.texture.dataUrl});
        }
        pending.status = 'exported';
        this.client.send('approval_result', {pendingId: id, status: 'exported'});
        Texture.markAsSaved();
        this.pending = null;
        this.revision++;
        this.emit('pending', null);
        this.publishState();
        return this.getSnapshot();
    }

    async applyAction(action) {
        switch (action.type) {
            case 'new_particle':
                startNewProject(true);
                break;
            case 'set_input':
                findInput(action.id).set(clone(action.value));
                break;
            case 'load_preset':
                loadPreset(action.id);
                break;
            case 'set_gradient': {
                const input = findInput(action.id || 'particle_color_gradient');
                const points = (action.points || action.value || []).map(point => ({percent: Math.max(0, Math.min(100, Number(point.percent ?? point.time * 100))), color: normalizeColor(point.color), id: bbuid(8)}));
                if (points.length < 2) throw new Error('A gradient requires at least two points');
                input.value.splice(0, Infinity, ...points);
                input.sortValues();
                input.selected = input.value[0];
                input.registerEdit();
                break;
            }
            case 'add_curve': {
                const curve = new Curve({mode: action.mode, input: action.input, range: action.range, nodes: clone(action.nodes || [0, 1])});
                curve.inputs.id.set(action.id || 'variable.curve');
                Data.variables.curves.curves.push(curve);
                curve.updateMinMax();
                break;
            }
            case 'update_curve': {
                const curve = Data.variables.curves.curves.find(item => item.inputs.id.value === action.id);
                if (!curve) throw new Error(`Curve not found: ${action.id}`);
                if (action.mode) curve.inputs.mode.set(action.mode);
                if (action.input !== undefined) curve.inputs.input.set(action.input);
                if (action.range !== undefined) curve.inputs.range.set(action.range);
                if (action.nodes) curve.nodes.splice(0, Infinity, ...clone(action.nodes));
                curve.updateMinMax();
                break;
            }
            case 'remove_curve': {
                const curve = Data.variables.curves.curves.find(item => item.inputs.id.value === action.id);
                if (!curve) throw new Error(`Curve not found: ${action.id}`);
                curve.remove();
                break;
            }
            case 'add_event': {
                const id = action.id || `event_${Data.events.events.events.length + 1}`;
                if (Config.events[id]) throw new Error(`Event already exists: ${id}`);
                const entry = {uuid: guid(), id, event: clone(action.event || {})};
                Data.events.events.events.push(entry);
                Config.events[id] = entry.event;
                break;
            }
            case 'update_event': {
                const entry = Data.events.events.events.find(item => item.id === action.id);
                if (!entry) throw new Error(`Event not found: ${action.id}`);
                entry.event = clone(action.event || {});
                Config.events[action.id] = entry.event;
                break;
            }
            case 'remove_event': {
                const index = Data.events.events.events.findIndex(item => item.id === action.id);
                if (index < 0) throw new Error(`Event not found: ${action.id}`);
                Data.events.events.events.splice(index, 1);
                delete Config.events[action.id];
                break;
            }
            case 'generate_texture': {
                const generated = generateTexture(action);
                await this.setTexture(generated.dataUrl, action.particleTexturePath, generated.width, generated.height);
                break;
            }
            case 'import_texture':
                await this.setTexture(action.dataUrl, action.particleTexturePath || action.path?.replace(/\.(png|tga)$/i, ''), action.width, action.height);
                break;
            case 'set_uv':
                if (action.size) findInput('particle_texture_size').set(action.size);
                if (action.uv) findInput('particle_texture_uv').set(action.uv);
                if (action.uvSize) findInput('particle_texture_uv_size').set(action.uvSize);
                if (action.step) findInput('particle_texture_uv_step').set(action.step);
                break;
            case 'preview_control':
                this.preview(action);
                break;
            case 'set_active_tab':
                this.app.setTab(action.tab);
                if (action.subject && this.app.$refs.sidebar) this.app.$refs.sidebar.selectSubject(action.subject);
                break;
            default:
                throw Object.assign(new Error(`Unsupported action type: ${action.type}`), {code: 'INVALID_ACTION'});
        }
    }

    async setTexture(dataUrl, particleTexturePath, width, height) {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw new Error('Texture data must be an image data URL');
        const encodedTexture = dataUrl.split(',', 2)[1] || '';
        if (encodedTexture.length * 3 / 4 > 4 * 1024 * 1024) throw Object.assign(new Error('Texture exceeds 4 MB'), {code: 'ASSET_TOO_LARGE'});
        const normalized = await normalizeTextureDataUrl(dataUrl);
        dataUrl = normalized.dataUrl;
        width = width || normalized.width;
        height = height || normalized.height;
        Texture.beforeEdit();
        Texture.source = dataUrl;
        await Texture.updateCanvasFromSource();
        Texture.internal_changes = true;
        Texture.update();
        Texture.afterEdit('agent texture');
        const texturePath = particleTexturePath || Config.particle_texture_path || `textures/particle/${String(Config.identifier || 'particle').replace(/^\w+:/, '')}`;
        findInput('particle_texture_path').set(texturePath.replace(/\.(png|tga)$/i, ''));
        findInput('particle_texture_size').set([width || Texture.canvas.width, height || Texture.canvas.height]);
        findInput('particle_texture_uv').set([0, 0]);
        findInput('particle_texture_uv_size').set([width || Texture.canvas.width, height || Texture.canvas.height]);
    }

    preview({action, value}) {
        if (!View.camera) throw Object.assign(new Error('Preview is not ready'), {code: 'PREVIEW_UNAVAILABLE'});
        switch (action) {
            case 'play': View.PlaybackController.start(); break;
            case 'pause': Emitter.paused = true; break;
            case 'reset': View.PlaybackController.stop().start(); break;
            case 'set_loop_mode':
                if (!['auto', 'looping', 'once'].includes(value)) throw Object.assign(new Error(`Unknown loop mode: ${value}`), {code: 'INVALID_ACTION'});
                Emitter.loop_mode = value;
                break;
            case 'set_parent_mode':
                if (!['world', 'entity', 'locator'].includes(value)) throw Object.assign(new Error(`Unknown parent mode: ${value}`), {code: 'INVALID_ACTION'});
                Emitter.parent_mode = value;
                break;
            case 'set_collision': Emitter.ground_collision = !!value; break;
            case 'set_camera': {
                if (value?.position) View.camera.position.fromArray(value.position);
                if (value?.target) View.controls.target.fromArray(value.target);
                View.controls.update();
                break;
            }
            default: throw new Error(`Unknown preview action: ${action}`);
        }
        this.publishState();
        return this.getPreviewState();
    }
}

export function createAgentRuntime(app) {
    return new AgentRuntime(app);
}
