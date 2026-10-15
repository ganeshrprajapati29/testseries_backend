import { ApiError } from '../utils/ApiError.js';
export function zodIssuesToDetails(error, prefix) {
    return error.issues.map((issue) => ({
        path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
        message: issue.message,
    }));
}
/**
 * Validates and replaces req.body / req.query / req.params with the parsed (typed, coerced,
 * stripped) values. Unknown keys are removed by zod objects by default.
 */
export function validate(schemas) {
    return (req, _res, next) => {
        const details = [];
        for (const part of ['params', 'query', 'body']) {
            const schema = schemas[part];
            if (!schema)
                continue;
            const result = schema.safeParse(req[part] ?? {});
            if (!result.success) {
                details.push(...zodIssuesToDetails(result.error, part));
                continue;
            }
            if (part === 'body') {
                req.body = result.data;
            }
            else {
                // Express 5 exposes query/params through getters, so define an own property instead.
                Object.defineProperty(req, part, { value: result.data, writable: true, enumerable: true, configurable: true });
            }
        }
        if (details.length)
            return next(ApiError.validation(details));
        next();
    };
}
//# sourceMappingURL=validate.js.map