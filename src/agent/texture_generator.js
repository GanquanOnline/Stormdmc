function parseColor(value, fallback = [255, 255, 255, 255]) {
    if (typeof value !== 'string') return fallback.slice();
    let hex = value.trim().replace(/^#/, '');
    if (hex.length === 3) hex = [...hex].map(c => c + c).join('');
    if (hex.length === 6) hex += 'ff';
    if (hex.length !== 8 || !/^[0-9a-f]+$/i.test(hex)) return fallback.slice();
    return [0, 2, 4, 6].map(i => parseInt(hex.substring(i, i + 2), 16));
}

function lerp(a, b, amount) {
    return a + (b - a) * amount;
}

function colorAt(colors, amount) {
    const palette = colors.length ? colors.map(parseColor) : [[255, 255, 255, 255], [0, 0, 0, 0]];
    const scaled = Math.max(0, Math.min(0.999999, amount)) * (palette.length - 1);
    const index = Math.floor(scaled);
    const mix = scaled - index;
    const a = palette[index];
    const b = palette[Math.min(index + 1, palette.length - 1)];
    return a.map((channel, i) => Math.round(lerp(channel, b[i], mix)));
}

function seededRandom(seed) {
    let state = (seed | 0) || 1;
    return () => {
        state = Math.imul(1664525, state) + 1013904223;
        return ((state >>> 0) & 0xfffffff) / 0xfffffff;
    };
}

function drawGlow(ctx, width, height, colors, radius = 0.5) {
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * radius);
    const palette = colors.length ? colors : ['#ffffffff', '#00000000'];
    palette.forEach((color, index) => gradient.addColorStop(index / Math.max(1, palette.length - 1), color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
}

export function generateTexture(recipe = {}) {
    const width = Math.max(8, Math.min(256, Math.round(recipe.width || 16)));
    const height = Math.max(8, Math.min(256, Math.round(recipe.height || 16)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const colors = recipe.colors || ['#ffffffff', '#00000000'];
    const random = seededRandom(recipe.seed || 1);
    ctx.clearRect(0, 0, width, height);

    switch (recipe.recipe) {
        case 'gradient': {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            colors.forEach((color, index) => gradient.addColorStop(index / Math.max(1, colors.length - 1), color));
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
            break;
        }
        case 'radial_glow':
            drawGlow(ctx, width, height, colors, 0.72);
            break;
        case 'ring': {
            drawGlow(ctx, width, height, ['#00000000', '#00000000']);
            const centerX = width / 2;
            const centerY = height / 2;
            const radius = Math.min(width, height) * 0.32;
            const ring = ctx.createRadialGradient(centerX, centerY, radius * 0.55, centerX, centerY, radius * 1.2);
            ring.addColorStop(0, '#00000000');
            ring.addColorStop(0.6, colors[0] || '#ffffffff');
            ring.addColorStop(1, colors[1] || '#00000000');
            ctx.fillStyle = ring;
            ctx.fillRect(0, 0, width, height);
            break;
        }
        case 'spark': {
            drawGlow(ctx, width, height, colors, 0.5);
            ctx.save();
            ctx.translate(width / 2, height / 2);
            ctx.rotate(Math.PI / 4);
            const spark = ctx.createLinearGradient(-width / 2, 0, width / 2, 0);
            spark.addColorStop(0, '#00000000');
            spark.addColorStop(0.5, colors[0] || '#ffffffff');
            spark.addColorStop(1, '#00000000');
            ctx.fillStyle = spark;
            ctx.fillRect(-width, -1, width * 2, 2);
            ctx.restore();
            break;
        }
        case 'flame': {
            drawGlow(ctx, width, height, colors.length ? colors : ['#ffff99ff', '#ff5500dd', '#22000000'], 0.78);
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            for (let i = 0; i < 6; i++) {
                const x = width * (0.25 + random() * 0.5);
                const y = height * (0.3 + random() * 0.45);
                const radius = Math.max(1, width * (0.08 + random() * 0.18));
                const puff = ctx.createRadialGradient(x, y, 0, x, y, radius);
                puff.addColorStop(0, colors[0] || '#ffffffff');
                puff.addColorStop(1, '#00000000');
                ctx.fillStyle = puff;
                ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
            }
            ctx.restore();
            break;
        }
        case 'smoke': {
            drawGlow(ctx, width, height, colors.length ? colors : ['#ffffffff', '#555555aa', '#00000000'], 0.8);
            ctx.save();
            for (let i = 0; i < 10; i++) {
                const x = width * (0.15 + random() * 0.7);
                const y = height * (0.15 + random() * 0.7);
                const radius = Math.max(1, width * (0.08 + random() * 0.2));
                const puff = ctx.createRadialGradient(x, y, 0, x, y, radius);
                puff.addColorStop(0, colors[0] || '#ffffffff');
                puff.addColorStop(1, '#00000000');
                ctx.fillStyle = puff;
                ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
            }
            ctx.restore();
            break;
        }
        case 'noise': {
            const image = ctx.createImageData(width, height);
            for (let i = 0; i < image.data.length; i += 4) {
                const value = Math.floor(random() * 255);
                const color = colorAt(colors, value / 255);
                image.data.set(color, i);
            }
            ctx.putImageData(image, 0, 0);
            break;
        }
        default:
            drawGlow(ctx, width, height, colors, 0.7);
    }

    return {dataUrl: canvas.toDataURL('image/png'), width, height};
}
