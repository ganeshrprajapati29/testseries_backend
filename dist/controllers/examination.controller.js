import * as examService from '../services/examination.service.js';
import { created, ok } from '../utils/ApiResponse.js';
export async function start(req, res) {
    const result = await examService.startAttempt(String(req.params.testId), req.auth.user.id, req.body?.language);
    return result.resumed ? ok(res, result, 'Resuming your test') : created(res, result, 'Test started');
}
export async function get(req, res) {
    return ok(res, await examService.getAttemptForExam(String(req.params.attemptId), req.auth.user.id));
}
export async function saveAnswer(req, res) {
    return ok(res, await examService.saveAnswers(String(req.params.attemptId), req.auth.user.id, [req.body]));
}
export async function saveAnswersBatch(req, res) {
    return ok(res, await examService.saveAnswers(String(req.params.attemptId), req.auth.user.id, req.body.answers));
}
export async function setLanguage(req, res) {
    return ok(res, await examService.changeAttemptLanguage(String(req.params.attemptId), req.auth.user.id, req.body.language));
}
export async function submit(req, res) {
    const result = await examService.submitAttempt(String(req.params.attemptId), req.auth.user.id);
    return ok(res, result, result.alreadySubmitted ? 'This test was already submitted' : 'Test submitted successfully');
}
//# sourceMappingURL=examination.controller.js.map