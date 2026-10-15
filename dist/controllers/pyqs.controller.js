import * as pyqsService from '../services/pyqs.service.js';
import * as testService from '../services/test.service.js';
import { ok } from '../utils/ApiResponse.js';
export async function home(_req, res) {
    return ok(res, await pyqsService.pyqHome());
}
/** /api/pyqs/category/nda or /api/pyqs/category/nda/maths */
export async function category(req, res) {
    const raw = req.params.path;
    const path = Array.isArray(raw) ? raw.join('/') : String(raw ?? '');
    return ok(res, await pyqsService.pyqCategory(path));
}
export async function paper(req, res) {
    await pyqsService.assertPyqPaper(String(req.params.slug));
    return ok(res, await testService.publicTestDetail(String(req.params.slug), req.auth?.user.id));
}
//# sourceMappingURL=pyqs.controller.js.map