export function clone(value) {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
}

export function stableDiff(before, after, basePath = '') {
    const result = [];
    const pathFor = key => basePath ? `${basePath}.${key}` : String(key);
    const isObject = value => value && typeof value === 'object';

    if (!isObject(before) || !isObject(after) || Array.isArray(before) !== Array.isArray(after)) {
        if (JSON.stringify(before) !== JSON.stringify(after)) result.push({path: basePath || '$', before, after});
        return result;
    }

    if (Array.isArray(before)) {
        const length = Math.max(before.length, after.length);
        for (let i = 0; i < length; i++) result.push(...stableDiff(before[i], after[i], `${basePath}[${i}]`));
        return result;
    }

    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) result.push(...stableDiff(before[key], after[key], pathFor(key)));
    return result;
}

export function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}
