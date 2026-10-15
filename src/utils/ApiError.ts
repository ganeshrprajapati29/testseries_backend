export interface ErrorDetail {
  path?: string;
  message: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ErrorDetail[];
  readonly isOperational = true;

  constructor(statusCode: number, message: string, code = 'ERROR', details?: ErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Bad request', details?: ErrorDetail[]) {
    return new ApiError(400, message, 'BAD_REQUEST', details);
  }

  static validation(details: ErrorDetail[], message = 'Validation failed') {
    return new ApiError(422, message, 'VALIDATION_ERROR', details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, message, 'FORBIDDEN');
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message, 'NOT_FOUND');
  }

  static conflict(message = 'Resource already exists', code = 'CONFLICT') {
    return new ApiError(409, message, code);
  }

  static tooMany(message = 'Too many requests, please try again later') {
    return new ApiError(429, message, 'TOO_MANY_REQUESTS');
  }

  static paymentRequired(message = 'Purchase required to access this content') {
    return new ApiError(402, message, 'PAYMENT_REQUIRED');
  }

  static unavailable(message = 'Service unavailable') {
    return new ApiError(503, message, 'SERVICE_UNAVAILABLE');
  }
}
