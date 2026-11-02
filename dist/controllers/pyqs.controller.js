import * as pyqsService from '../services/pyqs.service.js';
import * as testService from '../services/test.service.js';
import { cached } from '../services/cache.service.js';
import { ok } from '../utils/ApiResponse.js';
export async function home(_req, res) {
    return ok(res, await cached('catalog', 'pyqs:home', 300, () => pyqsService.pyqHome()));
}
/** /api/pyqs/category/nda or /api/pyqs/category/nda/maths */
export async function category(req, res) {
    const raw = req.params.path;
    const path = Array.isArray(raw) ? raw.join('/') : String(raw ?? '');
    const year = Number(req.query.year) || undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    return ok(res, await cached('catalog', `pyqs:category:${path.toLowerCase()}:${year ?? 'all'}:${page}:${limit}`, 300, () => pyqsService.pyqCategory(path, { year, page, limit })));
}
export async function paper(req, res) {
    await pyqsService.assertPyqPaper(String(req.params.slug));
    return ok(res, await testService.publicTestDetail(String(req.params.slug), req.auth?.user.id));
}
//# sourceMappingURL=pyqs.controller.js.map