export class TenantServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TenantServiceError";
  }
}

// Error code constants
export const AUTH_FAILED = "AUTH_FAILED";
export const TOKEN_EXPIRED = "TOKEN_EXPIRED";
export const TOKEN_INVALID = "TOKEN_INVALID";
export const MAS_AUTH_FAILED = "MAS_AUTH_FAILED";
export const USERNAME_TAKEN = "USERNAME_TAKEN";
export const SESSION_ACCESS_DENIED = "SESSION_ACCESS_DENIED";
export const PERMISSION_DENIED = "PERMISSION_DENIED";
export const OWNER_CANNOT_LEAVE = "OWNER_CANNOT_LEAVE";
export const RATE_LIMITED = "RATE_LIMITED";
export const WEAK_PASSWORD = "WEAK_PASSWORD";
export const ACCOUNT_PENDING_APPROVAL = "ACCOUNT_PENDING_APPROVAL";
export const ACCOUNT_REJECTED = "ACCOUNT_REJECTED";
export const ALREADY_MEMBER = "ALREADY_MEMBER";
export const NOT_A_MEMBER = "NOT_A_MEMBER";
export const ADMIN_USERNAME_REQUIRED = "ADMIN_USERNAME_REQUIRED";
export const JWT_SECRET_TOO_SHORT = "JWT_SECRET_TOO_SHORT";
export const SESSION_ARCHIVED = "SESSION_ARCHIVED";
export const NO_MESSAGES_TO_SUMMARIZE = "NO_MESSAGES_TO_SUMMARIZE";
export const LLM_NOT_CONFIGURED = "LLM_NOT_CONFIGURED";
