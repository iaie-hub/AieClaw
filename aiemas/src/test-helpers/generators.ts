/**
 * fast-check arbitraries for property-based testing.
 * Feature: mas4s-multi-tenant-rbac
 */

import * as fc from "fast-check";
import type { GlobalRole, SessionRole } from "../models.js";

// arbUsername: alphanumeric string, 3-20 chars
export const arbUsername = fc.stringMatching(/^[a-z][a-z0-9_]{2,19}$/);

// arbPassword: string of length 8-50 (valid password)
export const arbPassword = fc.string({ minLength: 8, maxLength: 50 }).filter((s) => s.length >= 8);

// arbWeakPassword: string of length 1-7 (too short)
export const arbWeakPassword = fc.string({ minLength: 1, maxLength: 7 });

// arbDisplayName: string of length 1-50
export const arbDisplayName = fc.string({ minLength: 1, maxLength: 50 });

// arbGlobalRole: one of "admin" | "member" | "viewer"
export const arbGlobalRole: fc.Arbitrary<GlobalRole> = fc.constantFrom("admin", "member", "viewer");

// arbSessionRole: one of "owner" | "participant"
export const arbSessionRole: fc.Arbitrary<SessionRole> = fc.constantFrom("owner", "participant");

// arbSessionKey: alphanumeric string, 5-30 chars
export const arbSessionKey = fc.stringMatching(/^[a-z0-9-]{5,30}$/);

// arbMethod: one of the known method names
export const arbMethod = fc.constantFrom(
  "system.status",
  "user.register",
  "user.approve",
  "user.reject",
  "user.list",
  "user.update",
  "sessions.create",
  "chat.send",
  "sessions.list",
  "sessions.resolve",
  "session.invite",
  "session.removeMember",
  "session.members",
  "session.leave",
  "exec.approval.resolve",
  "auth.login",
  "auth.refresh",
  "auth.verify",
);
