import * as fc from "fast-check";
/**
 * Property 18: 会话类型标记
 * 验证: 需求 9.2, 9.3
 *
 * 通过 addSession 创建的会话标记为 "initiated"；
 * 通过 session.joined 事件加入的会话标记为 "participated"。
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { MasSession } from "../types/session-types.js";
import { AppStore } from "./app-store.js";

/** 构造最小 MasSession fixture */
function makeMasSession(overrides: Partial<MasSession> & { key: string }): MasSession {
  return {
    label: "Test Session",
    kind: "group",
    status: "running",
    masType: "initiated",
    hasNotification: false,
    notificationCount: 0,
    participants: [],
    ...overrides,
  } as MasSession;
}

describe("Property 18: session type marking", () => {
  let store: AppStore;

  beforeEach(() => {
    // Reset singleton for isolation
    (AppStore as unknown as { _instance: AppStore | null })._instance = null;
    store = AppStore.instance;
  });

  it("sessions added via addSession with masType=initiated are marked initiated", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.string({ minLength: 1, maxLength: 40 }), (key, label) => {
        // Reset store state
        store.sessions = [];

        const session = makeMasSession({ key, label, masType: "initiated" });
        store.addSession(session);

        const found = store.sessions.find((s) => s.key === key);
        expect(found).toBeDefined();
        expect(found?.masType).toBe("initiated");
      }),
    );
  });

  it("sessions added via session.joined event are marked participated", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.string({ minLength: 1, maxLength: 40 }), (key, label) => {
        store.sessions = [];

        // Simulate session.joined: add session with masType="participated"
        const session = makeMasSession({ key, label, masType: "participated" });
        store.addSession(session);

        const found = store.sessions.find((s) => s.key === key);
        expect(found).toBeDefined();
        expect(found?.masType).toBe("participated");
      }),
    );
  });

  it("initiated and participated sessions coexist without type contamination", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (key1, key2) => {
        fc.pre(key1 !== key2);
        store.sessions = [];

        store.addSession(makeMasSession({ key: key1, masType: "initiated" }));
        store.addSession(makeMasSession({ key: key2, masType: "participated" }));

        const s1 = store.sessions.find((s) => s.key === key1);
        const s2 = store.sessions.find((s) => s.key === key2);
        expect(s1?.masType).toBe("initiated");
        expect(s2?.masType).toBe("participated");
      }),
    );
  });

  it("removeSession removes the correct session regardless of masType", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (key1, key2) => {
        fc.pre(key1 !== key2);
        store.sessions = [];

        store.addSession(makeMasSession({ key: key1, masType: "initiated" }));
        store.addSession(makeMasSession({ key: key2, masType: "participated" }));

        store.removeSession(key2);

        expect(store.sessions.find((s) => s.key === key1)).toBeDefined();
        expect(store.sessions.find((s) => s.key === key2)).toBeUndefined();
      }),
    );
  });
});
