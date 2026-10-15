export function ok(res, data, message, status = 200) {
    return res.status(status).json({ success: true, message, data });
}
export function created(res, data, message = 'Created successfully') {
    return ok(res, data, message, 201);
}
export function paginated(res, items, meta) {
    return res.status(200).json({ success: true, data: items, meta });
}
export function noContent(res) {
    return res.status(204).end();
}
//# sourceMappingURL=ApiResponse.js.map