import { Router, type IRouter, type Request } from "express";
import { pool } from "@workspace/db";
import {
  CreateComplaintBody,
  CreateItemBody,
  CreateRequestBody,
  CancelRequestBody,
  CancelRequestParams,
  DecideItemBody,
  DecideItemParams,
  DecideProviderBody,
  DecideProviderParams,
  DecideRequestBody,
  DecideRequestParams,
  GetAdminSummaryResponse,
  GetImpactResponse,
  GetItemParams,
  GetItemResponse,
  GetProfileResponse,
  GetSessionResponse,
  ListAdminComplaintsResponse,
  ListAdminAppealsResponse,
  ListAdminUsersResponse,
  ListComplaintsResponse,
  ListItemsQueryParams,
  ListItemsResponse,
  ListNotificationsResponse,
  ListPendingItemsResponse,
  ListPendingProvidersResponse,
  ListProviderItemsResponse,
  ListProviderRequestsResponse,
  ListRequestsResponse,
  LoginBody,
  LoginResponse,
  SubmitAppealBody,
  ModerateUserBody,
  ModerateUserParams,
  ModerateUserResponse,
  SubmitAppealResponse,
  DecideAppealBody,
  DecideAppealParams,
  DecideAppealResponse,
  RegisterProviderBody,
  RegisterProviderResponse,
  RegisterUserBody,
  RegisterUserResponse,
  ReplyToComplaintBody,
  ReplyToComplaintParams,
  UpdateItemBody,
  UpdateItemParams,
  UpdateItemResponse,
  UpdateProfileBody,
} from "@workspace/api-zod";
import {
  createSession,
  destroySession,
  getCurrentUser,
  hashPassword,
  profileFromUser,
  verifyPassword,
  type DeviceBridgeUser,
} from "../lib/devicebridge-auth";

const router: IRouter = Router();

function moderationView(row: Record<string, unknown>) {
  return {
    moderationStatus: String(row.moderation_status ?? "ACTIVE"),
    moderationReason: row.moderation_reason ?? null,
    moderationType: row.moderation_type ?? null,
    moderationUntil: row.moderation_until
      ? new Date(String(row.moderation_until)).toISOString()
      : null,
    appealAllowed: Boolean(row.appeal_allowed),
  };
}

function adminUserView(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    fullName: row.full_name,
    username: row.username,
    icNumber: row.ic_number,
    role: row.role,
    status: row.status ?? null,
    age: row.age == null ? null : Number(row.age),
    dateOfBirth: dateOnly(row.date_of_birth),
    occupation: row.occupation ?? null,
    position: row.position ?? null,
    school: row.school ?? null,
    providerType: row.provider_type ?? null,
    operationLocation: row.operation_location ?? null,
    shopName: row.shop_name ?? null,
    shopLocation: row.shop_location ?? null,
    description: row.description ?? null,
    contact: row.contact ?? null,
    verificationStatus: row.verification_status ?? null,
    ...moderationView(row),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

const itemSelect = `
  SELECT i.id, i.provider_id, i.name, i.category, i.brand, i.year, i.age, i.condition,
    i.original_price, i.sale_price, i.location, i.quantity, i.available_quantity,
    i.offers, i.loan_max_days, i.deposit_required, i.donation_announcement_date,
    (SELECT COUNT(*) FROM devicebridge_requests pr
      WHERE pr.item_id = i.id AND pr.status = 'PENDING') AS pending_request_count,
    (SELECT COUNT(*) FROM devicebridge_requests sr
      WHERE sr.item_id = i.id AND sr.type = 'DONATE' AND sr.status = 'APPROVED') AS served_count,
    i.status, i.rejection_reason,
    i.image_url, i.created_at, u.full_name AS provider_name,
    pp.shop_name AS provider_shop_name,
    pp.verification_status AS provider_verification_status,
    u.moderation_status AS provider_moderation_status
  FROM devicebridge_items i
  JOIN devicebridge_users u ON u.id = i.provider_id
  LEFT JOIN devicebridge_provider_profiles pp ON pp.user_id = u.id
`;

function publicItem(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category,
    brand: row.brand ?? null,
    year: row.year == null ? null : Number(row.year),
    age: row.age ?? null,
    condition: row.condition,
    originalPrice: row.original_price == null ? null : Number(row.original_price),
    salePrice: row.sale_price == null ? null : Number(row.sale_price),
    location: row.location,
    quantity: Number(row.quantity),
    availableQuantity: Number(row.available_quantity),
    offers: row.offers ?? [],
    loanMaxDays: row.loan_max_days == null ? null : Number(row.loan_max_days),
    depositRequired: Boolean(row.deposit_required),
    donationAnnouncementDate: row.donation_announcement_date ?? null,
    pendingRequestCount: Number(row.pending_request_count ?? 0),
    servedCount: Number(row.served_count ?? 0),
    status: row.status,
    rejectionReason: row.rejection_reason ?? null,
    imageUrl: row.image_url ?? null,
    providerName: row.provider_name,
    providerShopName: row.provider_shop_name ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function requestView(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    itemId: Number(row.item_id),
    itemName: row.item_name,
    requesterName: row.requester_name,
    type: row.type,
    purpose: row.purpose,
    phone: row.phone ?? null,
    pickupLocation: row.pickup_location ?? null,
    requestedDays: row.requested_days == null ? null : Number(row.requested_days),
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    requesterAge: row.requester_age == null ? null : Number(row.requester_age),
    requesterStatus: row.requester_status ?? null,
    requesterOccupation: row.requester_occupation ?? null,
    requesterPosition: row.requester_position ?? null,
    requesterSchool: row.requester_school ?? null,
    requesterDateOfBirth: dateOnly(row.requester_date_of_birth),
    status: row.status,
    agreementStatus: row.agreement_status ?? null,
    meetingAt: row.meeting_at ? new Date(String(row.meeting_at)).toISOString() : null,
    returnAt: row.return_at ? new Date(String(row.return_at)).toISOString() : null,
    cancelledAt: row.cancelled_at ? new Date(String(row.cancelled_at)).toISOString() : null,
    cancelledBy: row.cancelled_by ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

async function profileFor(user: DeviceBridgeUser) {
  const provider = await pool.query(
    "SELECT * FROM devicebridge_provider_profiles WHERE user_id = $1",
    [user.id],
  );
  return profileFromUser(user, provider.rows[0] ?? null);
}

async function notify(userId: number, title: string, body: string) {
  await pool.query(
    `INSERT INTO devicebridge_notifications (user_id, title, body)
     VALUES ($1, $2, $3)`,
    [userId, title, body],
  );
}

async function currentOr401(req: Request, res: any): Promise<DeviceBridgeUser | null> {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return user;
}

function numericParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

router.get("/auth/session", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  const result = {
    authenticated: Boolean(user),
    user: user ? await profileFor(user) : null,
  };
  res.json(GetSessionResponse.parse(result));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const identifier = parsed.data.identifier.trim();
  if (!identifier) {
    res.status(400).json({ error: "Enter your name, IC number, or username." });
    return;
  }
  const result = await pool.query<DeviceBridgeUser>(
    `SELECT id, username, full_name, ic_number, password_hash, role, status,
            moderation_status, moderation_reason, moderation_type,
            moderation_until, appeal_allowed, moderated_at, moderated_by, age,
            date_of_birth::text AS date_of_birth, occupation, position, school
       FROM devicebridge_users
      WHERE LOWER(username) = LOWER($1)
         OR LOWER(full_name) = LOWER($1)
         OR LOWER(ic_number) = LOWER($1)
      LIMIT 1`,
    [identifier],
  );
  const user = result.rows[0];
  if (!user) {
    res.status(401).json({ error: "Account not found. Please check your credentials or register an account." });
    return;
  }
  if (!verifyPassword(parsed.data.password, user.password_hash)) {
    res.status(401).json({ error: "Incorrect password. Please try again." });
    return;
  }
  if (["BANNED", "DELETED", "TERMINATED"].includes(user.moderation_status)) {
    const temporaryActive =
      user.moderation_status === "BANNED" &&
      user.moderation_type === "TEMPORARY" &&
      user.moderation_until &&
      new Date(user.moderation_until).getTime() > Date.now();
    const temporaryExpired =
      user.moderation_status === "BANNED" &&
      user.moderation_type === "TEMPORARY" &&
      user.moderation_until &&
      new Date(user.moderation_until).getTime() <= Date.now();
    if (temporaryExpired) {
      await pool.query(
        `UPDATE devicebridge_users
            SET moderation_status='ACTIVE', moderation_reason=NULL,
                moderation_type=NULL, moderation_until=NULL,
                appeal_allowed=false, moderated_at=NULL, moderated_by=NULL
          WHERE id=$1`,
        [user.id],
      );
    } else {
      const until = user.moderation_until
        ? new Date(String(user.moderation_until)).toISOString()
        : null;
      res.status(403).json({
        error: temporaryActive
          ? `Your account is temporarily banned until ${until}. Reason: ${user.moderation_reason || "No reason provided."}`
      : user.moderation_status === "DELETED"
            ? "Your account and IC number have been blacklisted and can no longer be used."
            : user.moderation_status === "TERMINATED"
              ? "Your account has been terminated. You can register again with this IC number."
            : `Your account is permanently banned. Reason: ${user.moderation_reason || "No reason provided."}`,
        code: user.moderation_status === "DELETED"
          ? "ACCOUNT_DELETED"
          : user.moderation_status === "TERMINATED"
            ? "ACCOUNT_TERMINATED"
            : "ACCOUNT_BANNED",
        appealAllowed: Boolean(user.appeal_allowed),
        moderationUntil: until,
      });
      return;
    }
  }
  const token = createSession(user.id);
  res.cookie("devicebridge_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
  res.json(LoginResponse.parse({
    authenticated: true,
    user: await profileFor(user),
  }));
});

router.post("/auth/logout", (req, res): void => {
  destroySession(req.cookies?.devicebridge_session as string | undefined);
  res.clearCookie("devicebridge_session");
  res.sendStatus(204);
});

router.post("/auth/change-password", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!verifyPassword(currentPassword, user.password_hash)) {
    res.status(400).json({ error: "Your current password is not correct." });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Your new password must be at least 8 characters." });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ error: "Your new password must be different from the current password." });
    return;
  }
  await pool.query(
    "UPDATE devicebridge_users SET password_hash=$1 WHERE id=$2",
    [hashPassword(newPassword), user.id],
  );
  res.sendStatus(204);
});

router.post("/auth/appeals", async (req, res): Promise<void> => {
  const parsed = SubmitAppealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const identifier = parsed.data.identifier.trim();
  const result = await pool.query<{
    id: number;
    moderation_status: string;
    appeal_allowed: boolean;
  }>(
    `SELECT id, moderation_status, appeal_allowed
       FROM devicebridge_users
      WHERE LOWER(username)=LOWER($1)
         OR LOWER(full_name)=LOWER($1)
         OR LOWER(ic_number)=LOWER($1)
      LIMIT 1`,
    [identifier],
  );
  const user = result.rows[0];
  if (!user || !user.appeal_allowed || !["BANNED", "DELETED"].includes(user.moderation_status)) {
    res.status(400).json({ error: "This account is not currently eligible for an appeal." });
    return;
  }
  const pending = await pool.query(
    "SELECT id FROM devicebridge_user_appeals WHERE user_id=$1 AND status='PENDING' LIMIT 1",
    [user.id],
  );
  if (pending.rows[0]) {
    res.status(400).json({ error: "An appeal for this account is already under review." });
    return;
  }
  const inserted = await pool.query(
    `INSERT INTO devicebridge_user_appeals (user_id, message)
     VALUES ($1, $2)
     RETURNING id, user_id, message, status, admin_note, created_at, reviewed_at`,
    [user.id, parsed.data.message.trim()],
  );
  const row = inserted.rows[0];
  res.status(201).json(SubmitAppealResponse.parse({
    id: Number(row.id),
    userId: Number(row.user_id),
    message: row.message,
    status: row.status,
    adminNote: row.admin_note ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    reviewedAt: row.reviewed_at ? new Date(String(row.reviewed_at)).toISOString() : null,
  }));
});

router.post("/auth/register/user", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const fullName = data.fullName.trim();
  const icNumber = data.icNumber.trim().toUpperCase();
  if (fullName.length < 2 || icNumber.length < 4) {
    res.status(400).json({ error: "Please enter a valid full name and IC number." });
    return;
  }
  const blacklist = await pool.query(
    "SELECT reason FROM devicebridge_user_blacklist WHERE ic_number=$1 LIMIT 1",
    [icNumber],
  );
  if (blacklist.rows[0]) {
    res.status(403).json({
      error: "This IC number is blacklisted and cannot be used to create another account.",
      code: "IC_BLACKLISTED",
    });
    return;
  }
  const terminated = await pool.query<DeviceBridgeUser>(
    `SELECT id, username, full_name, ic_number, password_hash, role, status,
            moderation_status, moderation_reason, moderation_type,
            moderation_until, appeal_allowed, moderated_at, moderated_by, age,
            date_of_birth::text AS date_of_birth, occupation, position, school
       FROM devicebridge_users
      WHERE ic_number=$1 AND role='USER' AND moderation_status='TERMINATED'
      LIMIT 1`,
    [icNumber],
  );
  if (terminated.rows[0]) {
    const updated = await pool.query<DeviceBridgeUser>(
      `UPDATE devicebridge_users
          SET username=$1, full_name=$2, password_hash=$3, status=$4,
              moderation_status='ACTIVE', moderation_reason=NULL,
              moderation_type=NULL, moderation_until=NULL,
              appeal_allowed=false, moderated_at=NULL, moderated_by=NULL,
              age=$5, date_of_birth=$6, occupation=$7, position=$8, school=$9
        WHERE id=$10
      RETURNING id, username, full_name, ic_number, password_hash, role, status,
        moderation_status, moderation_reason, moderation_type, moderation_until,
        appeal_allowed, moderated_at, moderated_by, age,
        date_of_birth::text AS date_of_birth, occupation, position, school`,
      [icNumber, fullName, hashPassword(data.password), data.status, data.age,
        data.dateOfBirth, data.occupation ?? null, data.position ?? null,
        data.school ?? null, terminated.rows[0].id],
    );
    const user = updated.rows[0];
    const token = createSession(user.id);
    res.cookie("devicebridge_session", token, { httpOnly: true, sameSite: "lax", maxAge: 604800000 });
    res.status(201).json(RegisterUserResponse.parse({ authenticated: true, user: await profileFor(user) }));
    return;
  }
  try {
    const inserted = await pool.query<DeviceBridgeUser>(
      `INSERT INTO devicebridge_users
       (username, full_name, ic_number, password_hash, role, status,
        moderation_status, appeal_allowed, age, date_of_birth, occupation, position, school)
       VALUES ($1, $2, $3, $4, 'USER', $5, 'ACTIVE', false, $6, $7, $8, $9, $10)
       RETURNING id, username, full_name, ic_number, password_hash, role, status,
         moderation_status, moderation_reason, moderation_type, moderation_until,
         appeal_allowed, moderated_at, moderated_by, age,
         date_of_birth::text AS date_of_birth, occupation, position, school`,
      [icNumber, fullName, icNumber, hashPassword(data.password),
        data.status, data.age, data.dateOfBirth, data.occupation ?? null,
        data.position ?? null, data.school ?? null],
    );
    const user = inserted.rows[0];
    const token = createSession(user.id);
    res.cookie("devicebridge_session", token, { httpOnly: true, sameSite: "lax", maxAge: 604800000 });
    res.status(201).json(RegisterUserResponse.parse({ authenticated: true, user: await profileFor(user) }));
  } catch (error) {
    req.log.warn({ error }, "User registration rejected");
    res.status(400).json({ error: "This IC number or account name is already registered." });
  }
});

router.post("/auth/register/provider", async (req, res): Promise<void> => {
  const parsed = RegisterProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const fullName = data.fullName.trim();
  const icNumber = data.icNumber.trim().toUpperCase();
  if (fullName.length < 2 || icNumber.length < 4) {
    res.status(400).json({ error: "Please enter a valid full name and IC number." });
    return;
  }
  const blacklist = await pool.query(
    "SELECT reason FROM devicebridge_user_blacklist WHERE ic_number=$1 LIMIT 1",
    [icNumber],
  );
  if (blacklist.rows[0]) {
    res.status(403).json({
      error: "This IC number is blacklisted and cannot be used to create another account.",
      code: "IC_BLACKLISTED",
    });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const terminated = await client.query<DeviceBridgeUser>(
      `SELECT id, username, full_name, ic_number, password_hash, role, status,
              moderation_status, moderation_reason, moderation_type,
              moderation_until, appeal_allowed, moderated_at, moderated_by, age,
              date_of_birth::text AS date_of_birth, occupation, position, school
         FROM devicebridge_users
        WHERE ic_number=$1 AND role='PROVIDER' AND moderation_status='TERMINATED'
        LIMIT 1
        FOR UPDATE`,
      [icNumber],
    );
    if (terminated.rows[0]) {
      const updated = await client.query<DeviceBridgeUser>(
        `UPDATE devicebridge_users
            SET username=$1, full_name=$2, password_hash=$3, status='PENDING VERIFICATION',
                moderation_status='ACTIVE', moderation_reason=NULL,
                moderation_type=NULL, moderation_until=NULL,
                appeal_allowed=false, moderated_at=NULL, moderated_by=NULL
          WHERE id=$4
        RETURNING id, username, full_name, ic_number, password_hash, role, status,
          moderation_status, moderation_reason, moderation_type, moderation_until,
          appeal_allowed, moderated_at, moderated_by, age,
          date_of_birth::text AS date_of_birth, occupation, position, school`,
        [icNumber, fullName, hashPassword(data.password), terminated.rows[0].id],
      );
      await client.query(
        `INSERT INTO devicebridge_provider_profiles
          (user_id, provider_type, operation_location, shop_name, shop_location, description, contact, verification_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING')
         ON CONFLICT (user_id) DO UPDATE SET
           provider_type=EXCLUDED.provider_type,
           operation_location=EXCLUDED.operation_location,
           shop_name=EXCLUDED.shop_name,
           shop_location=EXCLUDED.shop_location,
           description=EXCLUDED.description,
           contact=EXCLUDED.contact,
           verification_status='PENDING'`,
        [terminated.rows[0].id, data.providerType, data.operationLocation, data.shopName ?? null,
          data.shopLocation ?? null, data.description ?? null, data.contact ?? null],
      );
      await client.query("COMMIT");
      const user = updated.rows[0];
      const token = createSession(user.id);
      res.cookie("devicebridge_session", token, { httpOnly: true, sameSite: "lax", maxAge: 604800000 });
      res.status(201).json(RegisterProviderResponse.parse({ authenticated: true, user: await profileFor(user) }));
      return;
    }
    const inserted = await client.query<DeviceBridgeUser>(
      `INSERT INTO devicebridge_users
       (username, full_name, ic_number, password_hash, role, status, moderation_status, appeal_allowed)
       VALUES ($1, $2, $3, $4, 'PROVIDER', 'PENDING VERIFICATION', 'ACTIVE', false)
       RETURNING id, username, full_name, ic_number, password_hash, role, status,
         moderation_status, moderation_reason, moderation_type, moderation_until,
         appeal_allowed, moderated_at, moderated_by, age,
         date_of_birth::text AS date_of_birth, occupation, position, school`,
      [icNumber, fullName, icNumber, hashPassword(data.password)],
    );
    const user = inserted.rows[0];
    await client.query(
      `INSERT INTO devicebridge_provider_profiles
       (user_id, provider_type, operation_location, shop_name, shop_location, description, contact)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, data.providerType, data.operationLocation, data.shopName ?? null,
        data.shopLocation ?? null, data.description ?? null, data.contact ?? null],
    );
    await client.query("COMMIT");
    const token = createSession(user.id);
    res.cookie("devicebridge_session", token, { httpOnly: true, sameSite: "lax", maxAge: 604800000 });
    res.status(201).json(RegisterProviderResponse.parse({ authenticated: true, user: await profileFor(user) }));
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.warn({ error }, "Provider registration rejected");
    res.status(400).json({ error: "This IC number or account name is already registered." });
  } finally {
    client.release();
  }
});

router.get("/profile", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  res.json(GetProfileResponse.parse(await profileFor(user)));
});

router.patch("/profile", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const userValues: Array<[string, unknown]> = [
    ["full_name", data.fullName],
    ["age", data.age],
    ["date_of_birth", data.dateOfBirth],
    ["occupation", data.occupation],
    ["position", data.position],
    ["school", data.school],
  ];
  const userFields = userValues.filter(([, value]) => value !== undefined);
  if (userFields.length) {
    const set = userFields.map(([field], index) => `${field} = $${index + 1}`).join(", ");
    await pool.query(`UPDATE devicebridge_users SET ${set} WHERE id = $${userFields.length + 1}`,
      [...userFields.map(([, value]) => value), user.id]);
  }
  if (user.role === "PROVIDER") {
    const providerValues: Array<[string, unknown]> = [
      ["operation_location", data.operationLocation],
      ["shop_name", data.shopName],
      ["shop_location", data.shopLocation],
      ["description", data.description],
      ["contact", data.contact],
    ];
    const providerFields = providerValues.filter(([, value]) => value !== undefined);
    if (providerFields.length) {
      const set = providerFields.map(([field], index) => `${field} = $${index + 1}`).join(", ");
      await pool.query(
        `UPDATE devicebridge_provider_profiles SET ${set} WHERE user_id = $${providerFields.length + 1}`,
        [...providerFields.map(([, value]) => value), user.id],
      );
    }
  }
  const updated = await pool.query<DeviceBridgeUser>(
    `SELECT id, username, full_name, ic_number, password_hash, role, status, age,
            date_of_birth::text AS date_of_birth, occupation, position, school
       FROM devicebridge_users WHERE id = $1`,
    [user.id],
  );
  res.json(GetProfileResponse.parse(await profileFor(updated.rows[0])));
});

router.delete("/profile", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  if (user.role === "ADMIN") {
    res.status(403).json({ error: "Admin accounts cannot be terminated from the profile page." });
    return;
  }
  await pool.query(
    `UPDATE devicebridge_users
        SET moderation_status='TERMINATED',
            moderation_reason='Account terminated by the account holder.',
            moderation_type='SELF_TERMINATED',
            moderation_until=NULL,
            appeal_allowed=false,
            moderated_at=NOW(),
            moderated_by=NULL
      WHERE id=$1`,
    [user.id],
  );
  destroySession(req.cookies?.devicebridge_session as string | undefined);
  res.clearCookie("devicebridge_session");
  res.sendStatus(204);
});

router.get("/items", async (req, res): Promise<void> => {
  const parsed = ListItemsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const values: unknown[] = [];
  const where = [
    "i.status NOT IN ('PROCESSING APPROVAL', 'REJECTED')",
    "pp.verification_status = 'APPROVED'",
    "u.moderation_status = 'ACTIVE'",
  ];
  if (data.q) {
    values.push(`%${data.q}%`);
    where.push(`(i.name ILIKE $${values.length} OR i.category ILIKE $${values.length} OR COALESCE(i.brand, '') ILIKE $${values.length})`);
  }
  if (data.category) {
    values.push(data.category);
    where.push(`i.category = $${values.length}`);
  }
  if (data.location) {
    values.push(`%${data.location}%`);
    where.push(`i.location ILIKE $${values.length}`);
  }
  if (data.offer) {
    values.push(data.offer);
    where.push(`$${values.length} = ANY(i.offers)`);
  }
  if (data.availability) {
    if (data.availability === "AVAILABLE") where.push("i.available_quantity > 0 AND i.status = 'AVAILABLE'");
    else {
      values.push(data.availability);
      where.push(`i.status = $${values.length}`);
    }
  }
  const order = data.sort === "price_low"
    ? "i.sale_price ASC NULLS LAST"
    : data.sort === "price_high"
      ? "i.sale_price DESC NULLS LAST"
      : "i.created_at DESC";
  const result = await pool.query(
    `${itemSelect} WHERE ${where.join(" AND ")} ORDER BY ${order}`,
    values,
  );
  res.json(ListItemsResponse.parse(result.rows.map(publicItem)));
});

router.get("/items/:id", async (req, res): Promise<void> => {
  const parsed = GetItemParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await pool.query(`${itemSelect} WHERE i.id = $1`, [parsed.data.id]);
  if (!result.rows[0]) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const item = publicItem(result.rows[0]);
  const user = await getCurrentUser(req);
  const publicEligible =
    !["PROCESSING APPROVAL", "REJECTED"].includes(String(item.status)) &&
    result.rows[0].provider_verification_status === "APPROVED" &&
    result.rows[0].provider_moderation_status === "ACTIVE";
  if (!publicEligible &&
      (!user || (user.role !== "ADMIN" && result.rows[0].provider_id !== user.id))) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(GetItemResponse.parse(item));
});

router.get("/provider/items", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  if (user.role !== "PROVIDER" && user.role !== "ADMIN") {
    res.status(403).json({ error: "Provider access required" });
    return;
  }
  const result = await pool.query(
    `${itemSelect} WHERE i.provider_id = $1 ORDER BY i.created_at DESC`,
    [user.id],
  );
  res.json(ListProviderItemsResponse.parse(result.rows.map(publicItem)));
});

router.post("/items", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  if (user.role !== "PROVIDER") {
    res.status(403).json({ error: "Provider access required" });
    return;
  }
  const provider = await pool.query(
    "SELECT verification_status FROM devicebridge_provider_profiles WHERE user_id=$1",
    [user.id],
  );
  if (provider.rows[0]?.verification_status !== "APPROVED") {
    res.status(403).json({ error: "Your provider application must be approved before you can publish a listing." });
    return;
  }
  const parsed = CreateItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const inserted = await pool.query(
    `INSERT INTO devicebridge_items
      (provider_id, name, category, brand, year, age, condition, original_price, sale_price,
       location, quantity, available_quantity, offers, loan_max_days, deposit_required,
       donation_announcement_date, image_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [user.id, data.name, data.category, data.brand ?? null, data.year ?? null, data.age ?? null,
      data.condition, data.originalPrice ?? null, data.salePrice ?? null, data.location,
       data.quantity, data.offers, data.loanMaxDays ?? null, data.depositRequired,
       data.donationAnnouncementDate ?? null, data.imageUrl ?? null],
  );
  const itemId = inserted.rows[0].id;
  await pool.query(
    "INSERT INTO devicebridge_status_history (item_id, status) VALUES ($1, 'PROCESSING APPROVAL')",
    [itemId],
  );
  const result = await pool.query(`${itemSelect} WHERE i.id = $1`, [itemId]);
  res.status(201).json((await import("@workspace/api-zod")).CreateItemResponse.parse(publicItem(result.rows[0])));
});

router.patch("/items/:id", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const params = UpdateItemParams.safeParse(req.params);
  const parsed = UpdateItemBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const result = await pool.query(
    `UPDATE devicebridge_items SET name=$1, category=$2, brand=$3, year=$4, age=$5, condition=$6,
      original_price=$7, sale_price=$8, location=$9, quantity=$10,
      available_quantity=LEAST($10, available_quantity), offers=$11, loan_max_days=$12,
      deposit_required=$13, donation_announcement_date=$14, image_url=$15,
      status='PROCESSING APPROVAL', rejection_reason=NULL
     WHERE id=$16 AND provider_id=$17 RETURNING id`,
    [data.name, data.category, data.brand ?? null, data.year ?? null, data.age ?? null, data.condition,
      data.originalPrice ?? null, data.salePrice ?? null, data.location, data.quantity, data.offers,
      data.loanMaxDays ?? null, data.depositRequired, data.donationAnnouncementDate ?? null,
      data.imageUrl ?? null, params.data.id, user.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  await pool.query(
    "INSERT INTO devicebridge_status_history (item_id, status) VALUES ($1, 'PROCESSING APPROVAL')",
    [params.data.id],
  );
  const item = await pool.query(`${itemSelect} WHERE i.id = $1`, [params.data.id]);
  res.json(UpdateItemResponse.parse(publicItem(item.rows[0])));
});

async function requestList(userId: number, providerOnly: boolean) {
  const condition = providerOnly ? "i.provider_id = $1" : "r.requester_id = $1";
  const result = await pool.query(
    `SELECT r.*, i.name AS item_name, u.full_name AS requester_name,
        u.age AS requester_age, u.status AS requester_status,
        u.occupation AS requester_occupation, u.position AS requester_position,
        u.school AS requester_school, u.date_of_birth AS requester_date_of_birth
       FROM devicebridge_requests r
       JOIN devicebridge_items i ON i.id = r.item_id
       JOIN devicebridge_users u ON u.id = r.requester_id
      WHERE ${condition} ORDER BY r.created_at DESC`,
    [userId],
  );
  return result.rows.map(requestView);
}

async function adminRequestList() {
  const result = await pool.query(
    `SELECT r.*, i.name AS item_name, u.full_name AS requester_name,
        u.age AS requester_age, u.status AS requester_status,
        u.occupation AS requester_occupation, u.position AS requester_position,
        u.school AS requester_school, u.date_of_birth AS requester_date_of_birth
       FROM devicebridge_requests r
       JOIN devicebridge_items i ON i.id = r.item_id
       JOIN devicebridge_users u ON u.id = r.requester_id
      WHERE r.status = 'PENDING'
      ORDER BY r.created_at ASC`,
  );
  return result.rows.map(requestView);
}

router.get("/requests", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  res.json(ListRequestsResponse.parse(await requestList(user.id, false)));
});

router.get("/provider/requests", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  if (user.role !== "PROVIDER") {
    res.status(403).json({ error: "Provider access required" });
    return;
  }
  res.json(ListProviderRequestsResponse.parse(await requestList(user.id, true)));
});

router.get("/admin/requests", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  if (user.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  res.json((await import("@workspace/api-zod")).ListAdminRequestsResponse.parse(await adminRequestList()));
});

router.patch("/requests/:id/cancel", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const params = CancelRequestParams.safeParse(req.params);
  const parsed = CancelRequestBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const client = await pool.connect();
  let requestRow: Record<string, any> | undefined;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT r.*, i.name AS item_name, i.provider_id
         FROM devicebridge_requests r
         JOIN devicebridge_items i ON i.id=r.item_id
        WHERE r.id=$1 AND r.requester_id=$2
        FOR UPDATE`,
      [params.data.id, user.id],
    );
    requestRow = result.rows[0];
    if (!requestRow) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (!["PENDING", "APPROVED"].includes(String(requestRow.status))) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Only pending or approved requests can be cancelled." });
      return;
    }
    await client.query(
      `UPDATE devicebridge_requests
          SET status='CANCELLED', agreement_status='CANCELLED',
              cancelled_at=NOW(), cancelled_by='USER', cancellation_reason=$1
        WHERE id=$2`,
      [parsed.data.reason, params.data.id],
    );
    await client.query(
      `UPDATE devicebridge_items
          SET available_quantity = LEAST(quantity, available_quantity + 1),
              status = CASE WHEN status = 'PRE-RESERVED' THEN 'AVAILABLE' ELSE status END
        WHERE id=$1`,
      [requestRow.item_id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Request cancellation failed");
    res.status(500).json({ error: "We could not cancel that request right now. Please try again." });
    return;
  } finally {
    client.release();
  }
  if (!requestRow) {
    res.status(500).json({ error: "Request cancellation was not saved." });
    return;
  }
  await notify(requestRow.provider_id, "DeviceBridge request cancelled", `${user.full_name} cancelled their request for ${requestRow.item_name}.`);
  const rows = await requestList(user.id, false);
  const updated = rows.find((entry) => entry.id === params.data.id);
  res.json((await import("@workspace/api-zod")).CancelRequestResponse.parse(updated));
});

router.post("/requests", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const parsed = CreateRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const client = await pool.connect();
  let item: Record<string, any> | undefined;
  let requestId: number | undefined;
  try {
    await client.query("BEGIN");
      const itemResult = await client.query(
       `SELECT i.*
          FROM devicebridge_items i
          JOIN devicebridge_users provider ON provider.id=i.provider_id
          JOIN devicebridge_provider_profiles pp ON pp.user_id=provider.id
         WHERE i.id = $1
           AND i.status NOT IN ('PROCESSING APPROVAL','REJECTED')
           AND pp.verification_status='APPROVED'
           AND provider.moderation_status='ACTIVE'
         FOR UPDATE OF i`,
      [data.itemId],
    );
    item = itemResult.rows[0];
    if (!item) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Item not found or not publicly available" });
      return;
    }
    const offer = data.type === "BORROW" ? "LEND" : data.type === "BUY" ? "SELL" : data.type;
    if (!item.offers?.includes(offer)) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "This offer is not available for this listing." });
      return;
    }
    if (Number(item.available_quantity) < 1) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "All units are currently reserved. Please check back after the provider reviews the requests." });
      return;
    }
    const existing = await client.query(
      `SELECT id FROM devicebridge_requests
        WHERE item_id=$1 AND requester_id=$2 AND status IN ('PENDING','APPROVED') LIMIT 1`,
      [data.itemId, user.id],
    );
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "You already have an active request for this listing." });
      return;
    }
    if (data.type === "BORROW" && item.loan_max_days && data.requestedDays && data.requestedDays > item.loan_max_days) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: `The requested period cannot exceed ${item.loan_max_days} days.` });
      return;
    }
    const inserted = await client.query(
      `INSERT INTO devicebridge_requests
        (item_id, requester_id, type, purpose, phone, ic_number, pickup_location, requested_days, agreement_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UNDER REVIEW') RETURNING id`,
      [data.itemId, user.id, data.type, data.purpose, data.phone ?? null, data.icNumber ?? null,
        data.pickupLocation ?? null, data.requestedDays ?? null],
    );
    requestId = Number(inserted.rows[0].id);
    await client.query(
      `UPDATE devicebridge_items
          SET available_quantity = available_quantity - 1,
              status = CASE WHEN available_quantity <= 1 THEN 'PRE-RESERVED' ELSE status END
        WHERE id=$1`,
      [data.itemId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Request creation failed");
    res.status(500).json({ error: "We could not send that request right now. Please try again." });
    return;
  } finally {
    client.release();
  }
  if (!item || requestId === undefined) {
    res.status(500).json({ error: "Request was not created." });
    return;
  }
  await notify(item.provider_id, "New DeviceBridge request", `${user.full_name} requested your ${item.name}.`);
  const rows = await requestList(user.id, false);
  const created = rows.find((row) => row.id === requestId);
  res.status(201).json((await import("@workspace/api-zod")).CreateRequestResponse.parse(created));
});

router.patch("/requests/:id/decision", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const params = DecideRequestParams.safeParse(req.params);
  const parsed = DecideRequestBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.decision;
  const client = await pool.connect();
  let row: Record<string, any> | undefined;
  let startDate: string | null = null;
  let endDate: string | null = null;
  try {
    await client.query("BEGIN");
    const request = await client.query(
      `SELECT r.*, i.provider_id, i.name AS item_name, u.id AS requester_user_id
         FROM devicebridge_requests r JOIN devicebridge_items i ON i.id=r.item_id
         JOIN devicebridge_users u ON u.id=r.requester_id
        WHERE r.id=$1 FOR UPDATE`,
      [params.data.id],
    );
    row = request.rows[0];
    if (!row || (user.role !== "ADMIN" && row.provider_id !== user.id)) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (row.status !== "PENDING") {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "This request has already been reviewed." });
      return;
    }
    if (status === "APPROVED" && !parsed.data.meetingDate) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Choose a meeting date before approving this request." });
      return;
    }
    if (status === "APPROVED") {
      const meetingDate = parsed.data.meetingDate;
      if (!meetingDate || !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Meeting date must use YYYY-MM-DD." });
        return;
      }
      const meeting = new Date(`${meetingDate}T00:00:00.000Z`);
      if (Number.isNaN(meeting.getTime()) || meeting.toISOString().slice(0, 10) !== meetingDate) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Meeting date is invalid." });
        return;
      }
      startDate = meetingDate;
      if (row.type === "BORROW") {
        const requestedDays = Number(row.requested_days ?? 0);
        if (!Number.isInteger(requestedDays) || requestedDays < 1) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "A loan request must include the number of requested days." });
          return;
        }
        const end = new Date(meeting.getTime() + requestedDays * 86400000);
        endDate = end.toISOString().slice(0, 10);
      }
    }
    await client.query(
      `UPDATE devicebridge_requests
          SET status=$1, agreement_status=$2, start_date=$3, end_date=$4
        WHERE id=$5`,
      [status, status === "APPROVED" ? "MEETING SCHEDULED" : null,
        startDate, endDate, params.data.id],
    );
    if (status === "REJECTED") {
      await client.query(
        `UPDATE devicebridge_items
            SET available_quantity = LEAST(quantity, available_quantity + 1),
                status = CASE WHEN status = 'PRE-RESERVED' THEN 'AVAILABLE' ELSE status END
          WHERE id=$1`,
        [row.item_id],
      );
    } else {
      await client.query(
        "INSERT INTO devicebridge_status_history (item_id, status, note) VALUES ($1,$2,$3)",
        [row.item_id, row.type === "BORROW" ? "PRE-RESERVED" : "RESERVED",
          `Request #${params.data.id} approved; meeting ${startDate}${endDate ? `; return ${endDate}` : ""}`],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Request decision failed");
    res.status(500).json({ error: "We could not update that request right now. Please try again." });
    return;
  } finally {
    client.release();
  }
  if (!row) {
    res.status(500).json({ error: "Request decision was not saved." });
    return;
  }
  await notify(
    row.requester_user_id,
    `Request ${status.toLowerCase()}`,
    status === "APPROVED"
      ? `Your ${row.item_name} request is approved. Meet on ${startDate}${endDate ? `; return by ${endDate}` : ""}.`
      : `Your request for ${row.item_name} was rejected.`,
  );
  const rows = await requestList(user.id, user.role === "PROVIDER");
  const updated = rows.find((entry) => entry.id === params.data.id);
  res.json((await import("@workspace/api-zod")).DecideRequestResponse.parse(updated));
});

async function complaintView(row: Record<string, unknown>) {
  const messages = await pool.query(
    `SELECT m.id, u.full_name AS author_name, m.body, m.created_at, m.from_admin
       FROM devicebridge_messages m JOIN devicebridge_users u ON u.id=m.author_id
      WHERE m.complaint_id=$1 ORDER BY m.created_at ASC`,
    [row.id],
  );
  return {
    id: Number(row.id),
    category: row.category,
    description: row.description,
    reporterName: row.reporter_name ?? null,
    phone: row.phone ?? null,
    status: row.status,
    createdAt: new Date(String(row.created_at)).toISOString(),
    messages: messages.rows.map((message) => ({
      id: Number(message.id),
      authorName: message.author_name,
      body: message.body,
      createdAt: new Date(String(message.created_at)).toISOString(),
      fromAdmin: Boolean(message.from_admin),
    })),
  };
}

router.get("/support/complaints", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const result = await pool.query(
    "SELECT * FROM devicebridge_complaints WHERE user_id=$1 ORDER BY created_at DESC",
    [user.id],
  );
  res.json(ListComplaintsResponse.parse(await Promise.all(result.rows.map(complaintView))));
});

router.post("/support/complaints", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const parsed = CreateComplaintBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const inserted = await pool.query(
    `INSERT INTO devicebridge_complaints (user_id, category, description, phone)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [user.id, parsed.data.category, parsed.data.description, parsed.data.phone ?? null],
  );
  await pool.query(
    `INSERT INTO devicebridge_messages (complaint_id, author_id, body, from_admin)
     VALUES ($1,$2,$3,false)`,
    [inserted.rows[0].id, user.id, parsed.data.description],
  );
  res.status(201).json((await import("@workspace/api-zod")).CreateComplaintResponse.parse(await complaintView(inserted.rows[0])));
});

router.post("/support/complaints/:id/messages", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const params = ReplyToComplaintParams.safeParse(req.params);
  const parsed = ReplyToComplaintBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const complaint = await pool.query(
    "SELECT * FROM devicebridge_complaints WHERE id=$1 AND ($2='ADMIN' OR user_id=$3)",
    [params.data.id, user.role, user.id],
  );
  if (!complaint.rows[0]) {
    res.status(404).json({ error: "Complaint not found" });
    return;
  }
  const fromAdmin = user.role === "ADMIN";
  const inserted = await pool.query(
    `INSERT INTO devicebridge_messages (complaint_id, author_id, body, from_admin)
     VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
    [params.data.id, user.id, parsed.data.body, fromAdmin],
  );
  if (fromAdmin && parsed.data.status) {
    await pool.query("UPDATE devicebridge_complaints SET status=$1 WHERE id=$2", [parsed.data.status, params.data.id]);
    await notify(complaint.rows[0].user_id, "Support replied to your complaint", parsed.data.body);
  } else if (!fromAdmin) {
    const admin = await pool.query("SELECT id FROM devicebridge_users WHERE role='ADMIN' ORDER BY id LIMIT 1");
    if (admin.rows[0]) {
      await notify(admin.rows[0].id, "New reply on a complaint", parsed.data.body);
    }
  }
  const message = {
    id: Number(inserted.rows[0].id),
    authorName: user.full_name,
    body: parsed.data.body,
    createdAt: new Date(String(inserted.rows[0].created_at)).toISOString(),
    fromAdmin,
  };
  res.status(201).json((await import("@workspace/api-zod")).ReplyToComplaintResponse.parse(message));
});

router.get("/notifications", async (req, res): Promise<void> => {
  const user = await currentOr401(req, res);
  if (!user) return;
  const result = await pool.query(
    "SELECT id, title, body, read, created_at FROM devicebridge_notifications WHERE user_id=$1 ORDER BY created_at DESC",
    [user.id],
  );
  res.json(ListNotificationsResponse.parse(result.rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    body: row.body,
    read: Boolean(row.read),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }))));
});

async function requireAdmin(req: Request, res: any): Promise<DeviceBridgeUser | null> {
  const user = await currentOr401(req, res);
  if (!user) return null;
  if (user.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return user;
}

router.get("/admin/summary", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM devicebridge_users WHERE role='USER')::int AS users,
      (SELECT COUNT(*) FROM devicebridge_users WHERE role='PROVIDER')::int AS providers,
      (SELECT COUNT(*) FROM devicebridge_items WHERE status='AVAILABLE')::int AS active_items,
      (SELECT COUNT(*) FROM devicebridge_items WHERE status='ON LOAN')::int AS on_loan_items,
      (SELECT COUNT(*) FROM devicebridge_requests WHERE type='DONATE' AND status='APPROVED')::int AS donated_items,
      (SELECT COUNT(*) FROM devicebridge_requests WHERE type='BUY' AND status='APPROVED')::int AS sold_items,
      (SELECT COUNT(*) FROM devicebridge_requests WHERE status='PENDING')::int AS pending_requests,
      (SELECT COUNT(*) FROM devicebridge_complaints WHERE status IN ('OPEN','IN_REVIEW'))::int AS open_complaints,
      (SELECT COUNT(*) FROM devicebridge_items WHERE status='PROCESSING APPROVAL')::int AS pending_items,
      (SELECT COUNT(*) FROM devicebridge_provider_profiles WHERE verification_status='PENDING')::int AS pending_providers
  `);
  const row = result.rows[0];
  res.json(GetAdminSummaryResponse.parse({
    users: Number(row.users), providers: Number(row.providers), activeItems: Number(row.active_items),
    onLoanItems: Number(row.on_loan_items), donatedItems: Number(row.donated_items), soldItems: Number(row.sold_items),
    pendingRequests: Number(row.pending_requests), openComplaints: Number(row.open_complaints),
    pendingItems: Number(row.pending_items), pendingProviders: Number(row.pending_providers),
  }));
});

router.get("/admin/users", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.ic_number, u.role, u.status,
       u.age, u.date_of_birth::text AS date_of_birth, u.occupation, u.position, u.school,
       u.moderation_status, u.moderation_reason, u.moderation_type,
       u.moderation_until, u.appeal_allowed, u.created_at,
       pp.provider_type, pp.operation_location, pp.shop_name, pp.shop_location,
       pp.description, pp.contact, pp.verification_status
       FROM devicebridge_users u
       LEFT JOIN devicebridge_provider_profiles pp ON pp.user_id=u.id
      WHERE u.role IN ('USER', 'PROVIDER')
      ORDER BY u.created_at DESC`,
  );
  res.json(ListAdminUsersResponse.parse(result.rows.map(adminUserView)));
});

router.patch("/admin/users/:id/moderation", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const params = ModerateUserParams.safeParse(req.params);
  const parsed = ModerateUserBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const reason = data.reason.trim();
  if (reason.length < 5) {
    res.status(400).json({ error: "A clear reason is required before taking action." });
    return;
  }
  if (params.data.id === admin.id) {
    res.status(400).json({ error: "An admin cannot moderate their own account." });
    return;
  }
  if (["DELETE", "TERMINATE"].includes(data.action) && data.durationType !== "PERMANENT") {
    res.status(400).json({ error: "Deleted or terminated accounts must use permanent status." });
    return;
  }
  if (data.action === "TERMINATE" && data.appealAllowed) {
    res.status(400).json({ error: "Terminated accounts do not need an appeal because they can register again." });
    return;
  }
  if (data.durationType === "TEMPORARY" && (!data.durationDays || data.durationDays < 1)) {
    res.status(400).json({ error: "Temporary bans require a duration in days." });
    return;
  }
  const target = await pool.query<{
    id: number;
    role: string;
    ic_number: string;
  }>(
    "SELECT id, role, ic_number FROM devicebridge_users WHERE id=$1",
    [params.data.id],
  );
  if (!target.rows[0]) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (target.rows[0].role === "ADMIN") {
    res.status(400).json({ error: "Admin accounts cannot be moderated here." });
    return;
  }
  const until =
    data.durationType === "TEMPORARY"
      ? new Date(Date.now() + Number(data.durationDays) * 24 * 60 * 60 * 1000)
      : null;
  const moderationStatus =
    data.action === "DELETE"
      ? "DELETED"
      : data.action === "TERMINATE"
        ? "TERMINATED"
        : "BANNED";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE devicebridge_users
          SET moderation_status=$1, moderation_reason=$2,
              moderation_type=$3, moderation_until=$4,
              appeal_allowed=$5, moderated_at=NOW(), moderated_by=$6
        WHERE id=$7`,
      [
        moderationStatus,
        reason,
        data.durationType,
        until,
        data.durationType === "PERMANENT" && data.appealAllowed,
        admin.id,
        params.data.id,
      ],
    );
    await client.query(
      `INSERT INTO devicebridge_user_moderation
        (user_id, admin_id, action, duration_type, reason, moderation_until, appeal_allowed)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        params.data.id,
        admin.id,
        data.action,
        data.durationType,
        reason,
        until,
        data.durationType === "PERMANENT" && data.appealAllowed,
      ],
    );
    if (data.action === "TERMINATE") {
      await client.query(
        "DELETE FROM devicebridge_user_blacklist WHERE user_id=$1",
        [params.data.id],
      );
    } else if (data.durationType === "PERMANENT") {
      await client.query(
        `INSERT INTO devicebridge_user_blacklist (ic_number, user_id, reason, appeal_allowed)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (ic_number) DO UPDATE SET
           user_id=EXCLUDED.user_id, reason=EXCLUDED.reason,
           appeal_allowed=EXCLUDED.appeal_allowed`,
        [
          target.rows[0].ic_number,
          params.data.id,
          reason,
          Boolean(data.appealAllowed),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error, userId: params.data.id }, "User moderation failed");
    res.status(500).json({ error: "Could not update this account." });
    return;
  } finally {
    client.release();
  }
  const updated = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.ic_number, u.role, u.status,
       u.age, u.date_of_birth::text AS date_of_birth, u.occupation, u.position, u.school,
       u.moderation_status, u.moderation_reason, u.moderation_type,
       u.moderation_until, u.appeal_allowed, u.created_at,
       pp.provider_type, pp.operation_location, pp.shop_name, pp.shop_location,
       pp.description, pp.contact, pp.verification_status
       FROM devicebridge_users u
       LEFT JOIN devicebridge_provider_profiles pp ON pp.user_id=u.id
      WHERE u.id=$1`,
    [params.data.id],
  );
  res.json(ModerateUserResponse.parse(adminUserView(updated.rows[0])));
});

router.get("/admin/appeals", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const result = await pool.query(
    `SELECT a.id, a.user_id, a.message, a.status, a.admin_note,
       a.created_at, a.reviewed_at, u.full_name, u.ic_number, u.role,
       u.moderation_status, u.moderation_reason, u.appeal_allowed
       FROM devicebridge_user_appeals a
       JOIN devicebridge_users u ON u.id=a.user_id
      ORDER BY CASE WHEN a.status='PENDING' THEN 0 ELSE 1 END, a.created_at DESC`,
  );
  res.json(ListAdminAppealsResponse.parse(result.rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    fullName: row.full_name,
    icNumber: row.ic_number,
    role: row.role,
    moderationStatus: row.moderation_status,
    moderationReason: row.moderation_reason ?? null,
    appealAllowed: Boolean(row.appeal_allowed),
    message: row.message,
    status: row.status,
    adminNote: row.admin_note ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    reviewedAt: row.reviewed_at ? new Date(String(row.reviewed_at)).toISOString() : null,
  }))));
});

router.patch("/admin/appeals/:id/decision", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const params = DecideAppealParams.safeParse(req.params);
  const parsed = DecideAppealBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const appeal = await pool.query(
    `SELECT a.id, a.user_id
       FROM devicebridge_user_appeals a
      WHERE a.id=$1`,
    [params.data.id],
  );
  if (!appeal.rows[0]) {
    res.status(404).json({ error: "Appeal not found" });
    return;
  }
  const decision = parsed.data.decision === "APPROVED" ? "APPROVED" : "REJECTED";
  const note = parsed.data.note?.trim() || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (decision === "APPROVED") {
      await client.query(
        `UPDATE devicebridge_users
            SET moderation_status='ACTIVE', moderation_reason=NULL,
                moderation_type=NULL, moderation_until=NULL,
                appeal_allowed=false, moderated_at=NULL, moderated_by=NULL
          WHERE id=$1`,
        [appeal.rows[0].user_id],
      );
      await client.query(
        "DELETE FROM devicebridge_user_blacklist WHERE user_id=$1",
        [appeal.rows[0].user_id],
      );
    }
    await client.query(
      `UPDATE devicebridge_user_appeals
          SET status=$1, admin_note=$2, reviewed_at=NOW(), reviewed_by=$3
        WHERE id=$4`,
      [decision, note, admin.id, params.data.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error, appealId: params.data.id }, "Appeal decision failed");
    res.status(500).json({ error: "Could not update this appeal." });
    return;
  } finally {
    client.release();
  }
  const updated = await pool.query(
    `SELECT a.id, a.user_id, a.message, a.status, a.admin_note,
       a.created_at, a.reviewed_at, u.full_name, u.ic_number, u.role,
       u.moderation_status, u.moderation_reason, u.appeal_allowed
       FROM devicebridge_user_appeals a
       JOIN devicebridge_users u ON u.id=a.user_id
      WHERE a.id=$1`,
    [params.data.id],
  );
  const row = updated.rows[0];
  res.json(DecideAppealResponse.parse({
    id: Number(row.id),
    userId: Number(row.user_id),
    fullName: row.full_name,
    icNumber: row.ic_number,
    role: row.role,
    moderationStatus: row.moderation_status,
    moderationReason: row.moderation_reason ?? null,
    appealAllowed: Boolean(row.appeal_allowed),
    message: row.message,
    status: row.status,
    adminNote: row.admin_note ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    reviewedAt: row.reviewed_at ? new Date(String(row.reviewed_at)).toISOString() : null,
  }));
});

router.get("/admin/providers", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.ic_number, pp.provider_type, pp.operation_location,
      pp.shop_name, pp.shop_location, pp.description, pp.contact,
      pp.verification_status, pp.created_at
     FROM devicebridge_provider_profiles pp JOIN devicebridge_users u ON u.id=pp.user_id
     WHERE pp.verification_status='PENDING' ORDER BY pp.created_at ASC`,
  );
  res.json(ListPendingProvidersResponse.parse(result.rows.map((row) => ({
    id: Number(row.id), fullName: row.full_name, providerType: row.provider_type,
    icNumber: row.ic_number, operationLocation: row.operation_location,
    shopName: row.shop_name ?? null, shopLocation: row.shop_location ?? null,
    description: row.description ?? null, contact: row.contact ?? null,
    verificationStatus: row.verification_status, createdAt: new Date(String(row.created_at)).toISOString(),
  }))));
});

router.patch("/admin/providers/:id/decision", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const params = DecideProviderParams.safeParse(req.params);
  const parsed = DecideProviderBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const provider = await pool.query(
    `UPDATE devicebridge_provider_profiles SET verification_status=$1 WHERE user_id=$2 RETURNING *`,
    [parsed.data.decision, params.data.id],
  );
  if (!provider.rows[0]) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  await pool.query("UPDATE devicebridge_users SET status=$1 WHERE id=$2", [parsed.data.decision, params.data.id]);
  await notify(params.data.id, `Provider verification ${parsed.data.decision.toLowerCase()}`, parsed.data.reason ?? "Your verification was reviewed.");
  const result = await pool.query(
    `SELECT u.id, u.full_name, pp.provider_type, pp.operation_location, pp.shop_name,
      u.ic_number, pp.shop_location, pp.description, pp.contact,
      pp.verification_status, pp.created_at
     FROM devicebridge_provider_profiles pp JOIN devicebridge_users u ON u.id=pp.user_id WHERE u.id=$1`,
    [params.data.id],
  );
  const row = result.rows[0];
  res.json((await import("@workspace/api-zod")).DecideProviderResponse.parse({
    id: Number(row.id), fullName: row.full_name, icNumber: row.ic_number,
    providerType: row.provider_type, operationLocation: row.operation_location,
    shopName: row.shop_name ?? null, shopLocation: row.shop_location ?? null,
    description: row.description ?? null, contact: row.contact ?? null,
    verificationStatus: row.verification_status, createdAt: new Date(String(row.created_at)).toISOString(),
  }));
});

router.get("/admin/items", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const result = await pool.query(
    `${itemSelect} WHERE i.status='PROCESSING APPROVAL' ORDER BY i.created_at ASC`,
  );
  res.json(ListPendingItemsResponse.parse(result.rows.map(publicItem)));
});

router.patch("/admin/items/:id/decision", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const params = DecideItemParams.safeParse(req.params);
  const parsed = DecideItemBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const nextStatus = parsed.data.decision === "APPROVED" ? "AVAILABLE" : "REJECTED";
  const result = await pool.query(
    `UPDATE devicebridge_items SET status=$1, rejection_reason=$2 WHERE id=$3 RETURNING *`,
    [nextStatus, parsed.data.reason ?? null, params.data.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  await pool.query(
    "INSERT INTO devicebridge_status_history (item_id, status, note) VALUES ($1,$2,$3)",
    [params.data.id, nextStatus, parsed.data.reason ?? null],
  );
  await notify(
    result.rows[0].provider_id,
    `Item ${nextStatus.toLowerCase()}`,
    parsed.data.reason ?? `Your ${result.rows[0].name} listing was reviewed.`,
  );
  const item = await pool.query(`${itemSelect} WHERE i.id=$1`, [params.data.id]);
  res.json((await import("@workspace/api-zod")).DecideItemResponse.parse(publicItem(item.rows[0])));
});

router.get("/admin/complaints", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const result = await pool.query(
    `SELECT c.*, u.full_name AS reporter_name
       FROM devicebridge_complaints c
       JOIN devicebridge_users u ON u.id=c.user_id
      ORDER BY c.created_at DESC`,
  );
  res.json(ListAdminComplaintsResponse.parse(await Promise.all(result.rows.map(complaintView))));
});

router.get("/impact", async (_req, res): Promise<void> => {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(DISTINCT r.requester_id) FROM devicebridge_requests r
        JOIN devicebridge_users u ON u.id=r.requester_id
        WHERE r.status='APPROVED' AND u.status='STUDENT')::int AS students_helped,
      (SELECT COUNT(*) FROM devicebridge_requests WHERE type='BORROW' AND status='APPROVED')::int AS devices_loaned,
      (SELECT COUNT(*) FROM devicebridge_requests WHERE type='DONATE' AND status='APPROVED')::int AS devices_donated,
      (SELECT COUNT(*) FROM devicebridge_items WHERE condition ILIKE '%refurb%' AND status <> 'REJECTED')::int AS devices_refurbished,
      (SELECT COUNT(*) FROM devicebridge_requests WHERE status='APPROVED')::int AS successful_matches,
      (SELECT COALESCE(SUM(requested_days),0) FROM devicebridge_requests WHERE type='BORROW' AND status='APPROVED')::int AS usage_days
  `);
  const row = result.rows[0];
  res.json(GetImpactResponse.parse({
    studentsHelped: Number(row.students_helped),
    devicesLoaned: Number(row.devices_loaned),
    devicesDonated: Number(row.devices_donated),
    devicesRefurbished: Number(row.devices_refurbished),
    successfulMatches: Number(row.successful_matches),
    usageDays: Number(row.usage_days),
  }));
});

export default router;