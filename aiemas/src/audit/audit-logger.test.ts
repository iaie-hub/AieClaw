import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, it, expect, afterEach } from "vitest";
import { logPermissionFailure } from "../audit/audit-logger.js";

/**
 * Property 14: 权限失败审计日志
 * Validates: Requirement 11.3
 */
describe("AuditLogger tests", () => {
  const tmpLog = join(tmpdir(), `audit-test-${process.pid}.log`);

  afterEach(() => {
    if (existsSync(tmpLog)) {
      unlinkSync(tmpLog);
    }
  });

  it("Property 14: logPermissionFailure writes valid JSON line with all required fields", () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 36 }), { nil: null }),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        (userId, action, resource, reason) => {
          // Clean up between runs
          if (existsSync(tmpLog)) {
            unlinkSync(tmpLog);
          }

          const timestamp = Date.now();
          const entry = {
            userId,
            action,
            resource,
            timestamp,
            result: "denied" as const,
            reason,
            _logPath: tmpLog,
          };
          logPermissionFailure(entry);

          const content = readFileSync(tmpLog, "utf8");
          const lines = content.trimEnd().split("\n");
          expect(lines.length).toBe(1);

          const parsed = JSON.parse(lines[0]);
          expect(parsed.userId).toBe(userId);
          expect(parsed.action).toBe(action);
          expect(parsed.resource).toBe(resource);
          expect(parsed.timestamp).toBe(timestamp);
          expect(parsed.result).toBe("denied");
          if (reason !== undefined) {
            expect(parsed.reason).toBe(reason);
          }
        },
      ),
    );
  });
});
