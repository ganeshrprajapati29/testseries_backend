export const ROLES = ['student', 'admin', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];
export const ADMIN_ROLES: Role[] = ['admin', 'superadmin'];

export const ACCOUNT_STATUSES = ['active', 'suspended', 'deactivated'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const MODULE_TYPES = ['TEST_SERIES', 'PYQS'] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

export const CATEGORY_STATUSES = ['active', 'inactive', 'archived'] as const;

export const PUBLICATION_STATUSES = ['draft', 'published', 'unpublished', 'archived'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const ACCESS_TYPES = ['free', 'paid'] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

export const TEST_TYPES = ['FULL_LENGTH', 'SECTIONAL', 'CHAPTER', 'MINI', 'PYQ_PAPER'] as const;
export type TestType = (typeof TEST_TYPES)[number];

export const RESULT_VISIBILITY = ['IMMEDIATE', 'AFTER_WINDOW', 'HIDDEN'] as const;
export type ResultVisibility = (typeof RESULT_VISIBILITY)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const ATTEMPT_STATUSES = ['IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'EVALUATED'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ORDER_STATUSES = ['created', 'paid', 'failed', 'cancelled', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['captured', 'failed', 'refunded', 'authorized'] as const;

export const ENROLLMENT_SOURCES = ['free', 'purchase', 'admin'] as const;

export const IMPORT_STATUSES = ['validated', 'committed', 'failed', 'cancelled'] as const;

export const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];
