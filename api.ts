// Public type exports for external consumers.

export interface Team {
  id: string;
  name: string;
  createdAt: string;
}

export interface Member {
  id: string;
  teamId: string;
  name: string;
  role: "admin" | "member";
  agentId: string;
  createdAt: string;
  notes?: string;
}

export interface ChannelIdentity {
  memberId: string;
  channel: string;
  senderId: string;
}

export interface Invite {
  code: string;
  teamId: string;
  role: "admin" | "member";
  createdBy: string;
  expiresAt: string;
  usedBy?: string;
}

export interface TeamModeConfig {
  teamId: string;
  teamName: string;
  defaultRole?: "admin" | "member";
  sharedMemoryMaxChars?: number;
  requireJoinBeforeChat?: boolean;
}
