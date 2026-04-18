export type GlobalRole = "admin" | "member" | "viewer";
export type SessionRole = "owner" | "participant";
export type UserStatus = "pending" | "approved" | "rejected";

export interface Tenant {
  tenantId: string;
  name: string;
  createdAt: number;
}

export interface User {
  userId: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: GlobalRole;
  tenantId: string;
  status: UserStatus;
  createdAt: number;
}

/** 不含 passwordHash 的公开用户信息 */
export type PublicUser = Omit<User, "passwordHash"> & {
  isOnline?: boolean;
  lastSeenAt?: number | null;
  lastLoginAt?: number | null;
  lastOfflineAt?: number | null;
};

export interface SessionOwnership {
  sessionKey: string;
  userId: string;
  tenantId: string;
  createdAt: number;
}

export interface SessionMembership {
  sessionKey: string;
  userId: string;
  role: SessionRole;
  joinedAt: number;
}

export interface SessionMember {
  userId: string;
  displayName: string;
  role: SessionRole;
  joinedAt: number;
}

/** 拓扑图中的一条有向边 */
export interface TopologyEdge {
  from: string;
  to: string;
}

/** 一棵完整的拓扑树文档 */
export interface TopologyTree {
  edges: TopologyEdge[];
}
