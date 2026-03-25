import { describe, it, expect, beforeEach } from "vitest";
import { UserCache } from "./user-cache.js";
import type { CachedUser } from "./user-cache.js";

function makeUser(overrides: Partial<CachedUser> & { userId: string }): CachedUser {
  return {
    username: "alice",
    displayName: "Alice",
    passwordHash: "hash",
    role: "member",
    tenantId: "t1",
    status: "pending",
    createdAt: 1000,
    ...overrides,
  };
}

describe("UserCache", () => {
  let cache: UserCache;

  beforeEach(() => {
    cache = new UserCache();
  });

  it("findById returns undefined for unknown user", () => {
    expect(cache.findById("unknown")).toBeUndefined();
  });

  it("set and findById", () => {
    const user = makeUser({ userId: "u1" });
    cache.set(user);
    expect(cache.findById("u1")).toEqual(user);
  });

  it("findByUsername with tenantId", () => {
    const user = makeUser({ userId: "u1", username: "alice", tenantId: "t1" });
    cache.set(user);
    expect(cache.findByUsername("alice", "t1")).toEqual(user);
    expect(cache.findByUsername("alice", "t2")).toBeUndefined();
  });

  it("findByUsername without tenantId scans all", () => {
    cache.set(makeUser({ userId: "u1", username: "alice", tenantId: "t1" }));
    cache.set(makeUser({ userId: "u2", username: "bob", tenantId: "t1" }));
    expect(cache.findByUsername("bob")?.userId).toBe("u2");
  });

  it("patch updates mutable fields", () => {
    cache.set(makeUser({ userId: "u1", displayName: "Alice", status: "pending" }));
    const updated = cache.patch("u1", { displayName: "Alice Chen", status: "approved" });
    expect(updated?.displayName).toBe("Alice Chen");
    expect(updated?.status).toBe("approved");
    expect(cache.findById("u1")?.displayName).toBe("Alice Chen");
  });

  it("patch returns undefined for unknown user", () => {
    expect(cache.patch("nope", { displayName: "X" })).toBeUndefined();
  });

  it("size reflects number of users", () => {
    expect(cache.size()).toBe(0);
    cache.set(makeUser({ userId: "u1" }));
    cache.set(makeUser({ userId: "u2" }));
    expect(cache.size()).toBe(2);
  });

  it("set overwrites existing entry", () => {
    cache.set(makeUser({ userId: "u1", displayName: "Old" }));
    cache.set(makeUser({ userId: "u1", displayName: "New" }));
    expect(cache.findById("u1")?.displayName).toBe("New");
    expect(cache.size()).toBe(1);
  });

  it("secondary index is updated when username changes", () => {
    cache.set(makeUser({ userId: "u1", username: "alice", tenantId: "t1" }));
    // Rename
    cache.set(makeUser({ userId: "u1", username: "alice2", tenantId: "t1" }));
    expect(cache.findByUsername("alice", "t1")).toBeUndefined();
    expect(cache.findByUsername("alice2", "t1")?.userId).toBe("u1");
  });
});
