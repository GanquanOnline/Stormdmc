import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export class WorkspaceError extends Error {
  code: string;

  constructor(message: string, code = 'WORKSPACE_VIOLATION') {
    super(message);
    this.code = code;
  }
}

export class Workspace {
  readonly root: string;

  constructor(root: string) {
    const resolved = path.resolve(root);
    if (!fsSync.existsSync(resolved) || !fsSync.statSync(resolved).isDirectory()) {
      throw new Error(`Workspace does not exist: ${resolved}`);
    }
    this.root = fsSync.realpathSync(resolved);
  }

  resolve(relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new WorkspaceError('Only workspace-relative paths are allowed');
    }
    const candidate = path.resolve(this.root, relativePath);
    const relative = path.relative(this.root, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new WorkspaceError(`Path is outside the workspace: ${relativePath}`);
    }

    let existingAncestor = candidate;
    while (!fsSync.existsSync(existingAncestor)) {
      const next = path.dirname(existingAncestor);
      if (next === existingAncestor) break;
      existingAncestor = next;
    }
    const realAncestor = fsSync.realpathSync(existingAncestor);
    const ancestorRelative = path.relative(this.root, realAncestor);
    if (ancestorRelative === '..' || ancestorRelative.startsWith(`..${path.sep}`) || path.isAbsolute(ancestorRelative)) {
      throw new WorkspaceError(`Path resolves outside the workspace: ${relativePath}`);
    }
    return candidate;
  }

  async listTextures(relativeDir = 'textures'): Promise<string[]> {
    const directory = this.resolve(relativeDir);
    const result: string[] = [];
    const visit = async (current: string) => {
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          const realDirectory = fsSync.realpathSync(full);
          const relativeDirectory = path.relative(this.root, realDirectory);
          if (relativeDirectory === '..' || relativeDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDirectory)) continue;
          await visit(full);
        }
        else if (/\.(png|tga)$/i.test(entry.name)) result.push(path.relative(this.root, full).replaceAll(path.sep, '/'));
      }
    };
    await visit(directory);
    return result.sort();
  }

  async readParticle(relativePath: string): Promise<any> {
    const full = this.resolve(relativePath);
    const raw = await fs.readFile(full, 'utf8');
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new WorkspaceError('Particle file exceeds 2 MB', 'ASSET_TOO_LARGE');
    try {
      return JSON.parse(raw);
    } catch (error: any) {
      throw new WorkspaceError(`Invalid particle JSON: ${error?.message || 'parse failed'}`, 'VALIDATION_FAILED');
    }
  }

  async readTexture(relativePath: string): Promise<string> {
    const full = this.resolve(relativePath);
    const bytes = await fs.readFile(full);
    if (bytes.byteLength > 4 * 1024 * 1024) throw new WorkspaceError('Texture exceeds 4 MB', 'ASSET_TOO_LARGE');
    const extension = path.extname(full).toLowerCase() === '.tga' ? 'tga' : 'png';
    return `data:image/${extension};base64,${bytes.toString('base64')}`;
  }

  async writeParticle(relativePath: string, particle: any): Promise<void> {
    const full = this.resolve(relativePath);
    const raw = `${JSON.stringify(particle, null, '\t')}\n`;
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new WorkspaceError('Particle file exceeds 2 MB', 'ASSET_TOO_LARGE');
    await this.atomicWrite(full, raw);
  }

  async writeTexture(relativePath: string, dataUrl: string): Promise<void> {
    const full = this.resolve(relativePath.replace(/\.(tga|png)$/i, '') + '.png');
    const match = /^data:image\/[^;]+;base64,(.+)$/s.exec(dataUrl || '');
    if (!match) throw new WorkspaceError('Texture must be a base64 data URL', 'VALIDATION_FAILED');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.byteLength > 4 * 1024 * 1024) throw new WorkspaceError('Texture exceeds 4 MB', 'ASSET_TOO_LARGE');
    await this.atomicWrite(full, bytes);
  }

  private async atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, content);
      await fs.rename(temporary, filePath);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }
}
