import type { Types } from 'mongoose';
import type { Role } from './enums.js';

export interface AuthUser {
  id: string;
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  scope: 'student' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
      rawBody?: Buffer;
    }
  }
}

export {};
