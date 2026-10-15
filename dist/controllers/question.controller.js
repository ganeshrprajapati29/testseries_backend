import * as questionService from '../services/question.service.js';
import { audit } from '../services/audit.service.js';
import { storeImage } from '../services/storage.service.js';
import { ApiError } from '../utils/ApiError.js';
import { created, noContent, ok, paginated } from '../utils/ApiResponse.js';
export async function list(req, res) {
    const { items, meta } = await questionService.listQuestions(req.query);
    return paginated(res, items, meta);
}
export async function facets(_req, res) {
    return ok(res, await questionService.questionFacets());
}
export async function get(req, res) {
    return ok(res, await questionService.getQuestion(String(req.params.id)));
}
export async function create(req, res) {
    const question = await questionService.createQuestion(req.body, req.auth.user._id);
    await audit(req, { action: 'question.create', entityType: 'Question', entityId: question.id });
    return created(res, question);
}
export async function update(req, res) {
    const question = await questionService.updateQuestion(String(req.params.id), req.body, req.auth.user._id);
    await audit(req, { action: 'question.update', entityType: 'Question', entityId: question.id });
    return ok(res, question, 'Question updated');
}
export async function archive(req, res) {
    const question = await questionService.setQuestionActive(String(req.params.id), false, req.auth.user._id);
    await audit(req, { action: 'question.archive', entityType: 'Question', entityId: question.id });
    return ok(res, question, 'Question archived');
}
export async function restore(req, res) {
    const question = await questionService.setQuestionActive(String(req.params.id), true, req.auth.user._id);
    await audit(req, { action: 'question.restore', entityType: 'Question', entityId: question.id });
    return ok(res, question, 'Question restored');
}
export async function remove(req, res) {
    await questionService.deleteQuestion(String(req.params.id));
    await audit(req, { action: 'question.delete', entityType: 'Question', entityId: String(req.params.id) });
    return noContent(res);
}
export async function uploadImage(req, res) {
    if (!req.file)
        throw ApiError.badRequest('Choose an image to upload');
    const folder = req.query.folder === 'covers' ? 'covers' : 'questions';
    const stored = await storeImage(req.file.buffer, req.file.mimetype, folder);
    await audit(req, { action: 'file.upload', entityType: 'File', entityId: stored.key });
    return created(res, stored, 'Image uploaded');
}
//# sourceMappingURL=question.controller.js.map