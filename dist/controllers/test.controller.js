import * as testService from '../services/test.service.js';
import { audit } from '../services/audit.service.js';
import { created, ok, paginated } from '../utils/ApiResponse.js';
// ---------- public
export async function detail(req, res) {
    return ok(res, await testService.publicTestDetail(String(req.params.slug), req.auth?.user.id));
}
// ---------- admin
export async function adminList(req, res) {
    const { items, meta } = await testService.adminListTests(req.query);
    return paginated(res, items, meta);
}
export async function adminGet(req, res) {
    return ok(res, await testService.adminGetTest(String(req.params.id)));
}
export async function create(req, res) {
    const test = await testService.createTest(req.body, req.auth.user._id);
    await audit(req, { action: 'test.create', entityType: 'Test', entityId: test.id, summary: `Created "${test.title}"` });
    return created(res, test);
}
export async function update(req, res) {
    const test = await testService.updateTest(String(req.params.id), req.body, req.auth.user._id);
    await audit(req, { action: 'test.update', entityType: 'Test', entityId: test.id, summary: `Updated "${test.title}"` });
    return ok(res, test, 'Test updated');
}
export async function setQuestions(req, res) {
    const test = await testService.setTestQuestions(String(req.params.id), req.body.questionIds, req.auth.user._id);
    await audit(req, { action: 'test.questions_set', entityType: 'Test', entityId: test.id, metadata: { count: test.questionIds.length } });
    return ok(res, { questionCount: test.questionIds.length, totalMarks: test.totalMarks }, 'Questions updated');
}
export async function addQuestions(req, res) {
    const result = await testService.addTestQuestions(String(req.params.id), req.body.questionIds, req.auth.user._id);
    await audit(req, { action: 'test.questions_add', entityType: 'Test', entityId: String(req.params.id), metadata: result });
    return ok(res, result, `${result.added} question(s) added`);
}
export async function removeQuestion(req, res) {
    const test = await testService.removeTestQuestion(String(req.params.id), String(req.params.questionId), req.auth.user._id);
    await audit(req, { action: 'test.question_remove', entityType: 'Test', entityId: test.id, metadata: { questionId: req.params.questionId } });
    return ok(res, { questionCount: test.questionIds.length }, 'Question removed from test');
}
export async function setPublication(req, res) {
    const test = await testService.setTestPublication(String(req.params.id), req.body.publicationStatus, req.auth.user._id);
    await audit(req, { action: `test.${req.body.publicationStatus}`, entityType: 'Test', entityId: test.id, summary: `"${test.title}" -> ${test.publicationStatus}` });
    return ok(res, test, `Test ${test.publicationStatus}`);
}
export async function duplicate(req, res) {
    const copy = await testService.duplicateTest(String(req.params.id), req.auth.user._id);
    await audit(req, { action: 'test.duplicate', entityType: 'Test', entityId: copy.id, metadata: { sourceId: req.params.id } });
    return created(res, copy, 'Test duplicated as draft');
}
export async function preview(req, res) {
    return ok(res, await testService.previewTest(String(req.params.id)));
}
export async function remove(req, res) {
    const result = await testService.removeTest(String(req.params.id), req.auth.user._id);
    await audit(req, { action: result.archived ? 'test.archive' : 'test.delete', entityType: 'Test', entityId: String(req.params.id) });
    return ok(res, result, result.archived ? 'Test has attempts, so it was archived instead of deleted' : 'Test deleted');
}
//# sourceMappingURL=test.controller.js.map