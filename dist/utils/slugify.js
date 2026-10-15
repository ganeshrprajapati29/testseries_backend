import crypto from 'node:crypto';
export function slugify(input) {
    return input
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || crypto.randomBytes(3).toString('hex');
}
/**
 * Returns a slug that does not collide according to `exists`.
 * Appends -2, -3 ... and finally a random suffix.
 */
export async function uniqueSlug(base, exists) {
    const root = slugify(base);
    if (!(await exists(root)))
        return root;
    for (let i = 2; i < 50; i++) {
        const candidate = `${root}-${i}`;
        if (!(await exists(candidate)))
            return candidate;
    }
    return `${root}-${crypto.randomBytes(3).toString('hex')}`;
}
//# sourceMappingURL=slugify.js.map