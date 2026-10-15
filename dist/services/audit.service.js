import { logger } from '../config/logger.js';
import { AuditLogModel } from '../models/AuditLog.model.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
/** Records a sensitive action. Failures are logged but never break the main request. */
export async function audit(req, entry) {
    try {
        await AuditLogModel.create({
            actorId: req.auth?.user._id ?? null,
            actorEmail: req.auth?.user.email ?? '',
            actorRole: req.auth?.user.role ?? '',
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId ?? null,
            summary: entry.summary ?? '',
            metadata: entry.metadata ?? {},
            ip: req.ip ?? '',
            userAgent: (req.get('user-agent') ?? '').slice(0, 512),
        });
    }
    catch (err) {
        logger.error({ err, entry }, 'Failed to write audit log');
    }
}
export async function listAuditLogs(q) {
    const { page, limit, skip } = pageParams(q.page, q.limit);
    const filter = {};
    if (q.action)
        filter.action = q.action;
    if (q.entityType)
        filter.entityType = q.entityType;
    if (q.actor)
        filter.actorEmail = { $regex: escapeRegex(q.actor), $options: 'i' };
    if (q.from || q.to) {
        filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    }
    const [items, total] = await Promise.all([
        AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        AuditLogModel.countDocuments(filter),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
}
//# sourceMappingURL=audit.service.js.map