import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Team, Member, ChannelIdentity, Invite } from "../api.js";

function resolveDbPath(teamId: string): string {
  return join(homedir(), ".openclaw", "team", teamId, "members.db");
}

export class MemberStore {
  private db: Database.Database;
  public readonly teamId: string;

  constructor(teamId: string, dbPath?: string) {
    this.teamId = teamId;
    const resolvedPath = dbPath ?? resolveDbPath(teamId);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS members (
        id          TEXT PRIMARY KEY,
        team_id     TEXT NOT NULL REFERENCES teams(id),
        name        TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        agent_id    TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        notes       TEXT
      );

      CREATE TABLE IF NOT EXISTS channel_identities (
        member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        channel     TEXT NOT NULL,
        sender_id   TEXT NOT NULL,
        PRIMARY KEY (channel, sender_id)
      );

      CREATE INDEX IF NOT EXISTS idx_identities_member
        ON channel_identities(member_id);

      CREATE TABLE IF NOT EXISTS invites (
        code        TEXT PRIMARY KEY,
        team_id     TEXT NOT NULL REFERENCES teams(id),
        role        TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        created_by  TEXT NOT NULL REFERENCES members(id),
        expires_at  TEXT NOT NULL,
        used_by     TEXT REFERENCES members(id)
      );
    `);
  }

  // --- Teams ---

  createTeam(team: Team): void {
    this.db.prepare(
      "INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)",
    ).run(team.id, team.name, team.createdAt);
  }

  getTeam(teamId: string): Team | undefined {
    const row = this.db.prepare(
      "SELECT id, name, created_at as createdAt FROM teams WHERE id = ?",
    ).get(teamId) as { id: string; name: string; createdAt: string } | undefined;
    return row ? { id: row.id, name: row.name, createdAt: row.createdAt } : undefined;
  }

  // --- Members ---

  createMember(member: Member): void {
    const txn = this.db.transaction(() => {
      this.db.prepare(
        "INSERT INTO members (id, team_id, name, role, agent_id, created_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        member.id,
        member.teamId,
        member.name,
        member.role,
        member.agentId,
        member.createdAt,
        member.notes ?? null,
      );
    });
    txn();
  }

  getMember(id: string): Member | undefined {
    const row = this.db.prepare(
      `SELECT id, team_id as teamId, name, role, agent_id as agentId,
              created_at as createdAt, notes
       FROM members WHERE id = ?`,
    ).get(id) as MemberRow | undefined;
    return row ? toMember(row) : undefined;
  }

  getMemberByAgentId(agentId: string): Member | undefined {
    const row = this.db.prepare(
      `SELECT id, team_id as teamId, name, role, agent_id as agentId,
              created_at as createdAt, notes
       FROM members WHERE agent_id = ?`,
    ).get(agentId) as MemberRow | undefined;
    return row ? toMember(row) : undefined;
  }

  getMemberBySenderId(channel: string, senderId: string): Member | undefined {
    const row = this.db.prepare(
      `SELECT m.id, m.team_id as teamId, m.name, m.role, m.agent_id as agentId,
              m.created_at as createdAt, m.notes
       FROM members m
       JOIN channel_identities ci ON ci.member_id = m.id
       WHERE ci.channel = ? AND ci.sender_id = ?`,
    ).get(channel, senderId) as MemberRow | undefined;
    return row ? toMember(row) : undefined;
  }

  listMembers(teamId: string): Member[] {
    const rows = this.db.prepare(
      `SELECT id, team_id as teamId, name, role, agent_id as agentId,
              created_at as createdAt, notes
       FROM members WHERE team_id = ? ORDER BY created_at ASC`,
    ).all(teamId) as MemberRow[];
    return rows.map(toMember);
  }

  removeMember(id: string): boolean {
    const result = this.db.prepare("DELETE FROM members WHERE id = ?").run(id);
    return result.changes > 0;
  }

  updateMemberRole(id: string, role: "admin" | "member"): boolean {
    const result = this.db.prepare(
      "UPDATE members SET role = ? WHERE id = ?",
    ).run(role, id);
    return result.changes > 0;
  }

  updateMemberNotes(id: string, notes: string | null): boolean {
    const result = this.db.prepare(
      "UPDATE members SET notes = ? WHERE id = ?",
    ).run(notes, id);
    return result.changes > 0;
  }

  // --- Channel Identities ---

  addIdentity(memberId: string, channel: string, senderId: string): void {
    this.db.prepare(
      "INSERT OR IGNORE INTO channel_identities (member_id, channel, sender_id) VALUES (?, ?, ?)",
    ).run(memberId, channel, senderId);
  }

  getIdentities(memberId: string): ChannelIdentity[] {
    return this.db.prepare(
      `SELECT member_id as memberId, channel, sender_id as senderId
       FROM channel_identities WHERE member_id = ?`,
    ).all(memberId) as ChannelIdentity[];
  }

  // --- Invites ---

  createInvite(invite: Invite): void {
    this.db.prepare(
      `INSERT INTO invites (code, team_id, role, created_by, expires_at, used_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      invite.code,
      invite.teamId,
      invite.role,
      invite.createdBy,
      invite.expiresAt,
      invite.usedBy ?? null,
    );
  }

  getInvite(code: string): Invite | undefined {
    const row = this.db.prepare(
      `SELECT code, team_id as teamId, role, created_by as createdBy,
              expires_at as expiresAt, used_by as usedBy
       FROM invites WHERE code = ?`,
    ).get(code) as InviteRow | undefined;
    return row ? toInvite(row) : undefined;
  }

  redeemInvite(code: string, memberId: string): boolean {
    const result = this.db.prepare(
      "UPDATE invites SET used_by = ? WHERE code = ? AND used_by IS NULL",
    ).run(memberId, code);
    return result.changes > 0;
  }

  cleanExpiredInvites(): number {
    const result = this.db.prepare(
      "DELETE FROM invites WHERE expires_at < datetime('now') AND used_by IS NULL",
    ).run();
    return result.changes;
  }

  // --- Utilities ---

  close(): void {
    this.db.close();
  }

  static generateId(): string {
    return randomUUID();
  }

  static generateInviteCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
  }
}

// --- Internal row types ---

interface MemberRow {
  id: string;
  teamId: string;
  name: string;
  role: string;
  agentId: string;
  createdAt: string;
  notes: string | null;
}

interface InviteRow {
  code: string;
  teamId: string;
  role: string;
  createdBy: string;
  expiresAt: string;
  usedBy: string | null;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    role: row.role as "admin" | "member",
    agentId: row.agentId,
    createdAt: row.createdAt,
    notes: row.notes ?? undefined,
  };
}

function toInvite(row: InviteRow): Invite {
  return {
    code: row.code,
    teamId: row.teamId,
    role: row.role as "admin" | "member",
    createdBy: row.createdBy,
    expiresAt: row.expiresAt,
    usedBy: row.usedBy ?? undefined,
  };
}
