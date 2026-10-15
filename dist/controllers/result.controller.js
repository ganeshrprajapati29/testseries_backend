import * as resultService from '../services/result.service.js';
import { audit } from '../services/audit.service.js';
import { ok, paginated } from '../utils/ApiResponse.js';
// ---------- student
export async function myResult(req, res) {
    return ok(res, await resultService.getStudentResult(String(req.params.attemptId), req.auth.user.id));
}
export async function mySolutions(req, res) {
    return ok(res, await resultService.getSolutions(String(req.params.attemptId), req.auth.user.id));
}
// ---------- admin
export async function adminList(req, res) {
    const { items, meta } = await resultService.adminListResults(req.query);
    return paginated(res, items, meta);
}
export async function adminExport(req, res) {
    const csv = await resultService.adminResultsCsv(req.query);
    await audit(req, { action: 'results.export', entityType: 'Result', metadata: { query: req.query } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="results-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`${String.fromCharCode(0xfeff)}${csv}`);
}
export async function adminAttempts(req, res) {
    const { items, meta } = await resultService.adminListAttempts(req.query);
    return paginated(res, items, meta);
}
export async function adminAttemptDetail(req, res) {
    return ok(res, await resultService.adminAttemptDetail(String(req.params.id)));
}
//# sourceMappingURL=result.controller.js.map