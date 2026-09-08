import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { pool } from "@workspace/db";

export type DeviceBridgeUser = {
  id: number;
  username: string;
  full_name: string;
  ic_number: string;
  password_hash: string;
  role: string;
  status: string | null;
  moderation_status: string;
  moderation_reason: string | null;
  moderation_type: string | null;
  moderation_until: string | Date | null;
  appeal_allowed: boolean;
  moderated_at: string | Date | null;
  moderated_by: number | null;
  age: number | null;
  date_of_birth: string | null;
  occupation: string | null;
  position: string | null;
  school: string | null;
};

const sessions = new Map<string, number>();

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  try {
    const actual = scryptSync(password, salt, 64).toString("hex");
    const actualBuffer = Buffer.from(actual, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function createSession(userId: number): string {
  const token = createHash("sha256")
    .update(`${userId}:${randomBytes(32).toString("hex")}`)
    .digest("hex");
  sessions.set(token, userId);
  return token;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

export async function getCurrentUser(req: Request): Promise<DeviceBridgeUser | null> {
  const token = req.cookies?.devicebridge_session as string | undefined;
  const userId = token ? sessions.get(token) : undefined;
  if (!userId) return null;
  const result = await pool.query<DeviceBridgeUser>(
    `SELECT id, username, full_name, ic_number, password_hash, role, status,
            moderation_status, moderation_reason, moderation_type,
            moderation_until, appeal_allowed, moderated_at, moderated_by, age,
            date_of_birth::text AS date_of_birth, occupation, position, school
       FROM devicebridge_users WHERE id = $1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) return null;
  if (["BANNED", "DELETED", "TERMINATED"].includes(user.moderation_status)) {
    if (
      user.moderation_status === "BANNED" &&
      user.moderation_type === "TEMPORARY" &&
      user.moderation_until &&
      new Date(user.moderation_until).getTime() <= Date.now()
    ) {
      await pool.query(
        `UPDATE devicebridge_users
            SET moderation_status='ACTIVE', moderation_reason=NULL,
                moderation_type=NULL, moderation_until=NULL,
                appeal_allowed=false, moderated_at=NULL, moderated_by=NULL
          WHERE id=$1`,
        [user.id],
      );
      return { ...user, moderation_status: "ACTIVE", moderation_reason: null, moderation_type: null, moderation_until: null, appeal_allowed: false, moderated_at: null, moderated_by: null };
    }
    return null;
  }
  return user;
}

export async function ensureAdminAccount(): Promise<void> {
  const existing = await pool.query<{
    id: number;
    password_hash: string;
    role: string;
    status: string | null;
  }>(
    "SELECT id, password_hash, role, status FROM devicebridge_users WHERE username = $1 LIMIT 1",
    ["admin001"],
  );
  const admin = existing.rows[0];
  if (admin) {
    if (
      admin.role === "ADMIN" &&
      admin.status === "ACTIVE" &&
      verifyPassword("AdzFS4A", admin.password_hash)
    ) {
      return;
    }
    await pool.query(
      `UPDATE devicebridge_users
          SET password_hash = $1, role = 'ADMIN', status = 'ACTIVE'
        WHERE id = $2`,
      [hashPassword("AdzFS4A"), admin.id],
    );
    return;
  }
  await pool.query(
    `INSERT INTO devicebridge_users
      (username, full_name, ic_number, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE')`,
    ["admin001", "DeviceBridge Admin", "ADMIN001", hashPassword("AdzFS4A")],
  );
}

export function profileFromUser(
  user: DeviceBridgeUser,
  provider?: Record<string, unknown> | null,
) {
  return {
    id: user.id,
    fullName: user.full_name,
    role: user.role,
    username: user.username,
    status: user.status,
    age: user.age,
    dateOfBirth: user.date_of_birth,
    occupation: user.occupation,
    position: user.position,
    school: user.school,
    providerType: provider?.provider_type ?? null,
    operationLocation: provider?.operation_location ?? null,
    shopName: provider?.shop_name ?? null,
    shopLocation: provider?.shop_location ?? null,
    description: provider?.description ?? null,
    contact: provider?.contact ?? null,
    verificationStatus: provider?.verification_status ?? null,
  };
}