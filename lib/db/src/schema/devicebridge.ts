import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("devicebridge_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  fullName: text("full_name").notNull(),
  icNumber: text("ic_number").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("USER"),
  status: text("status"),
  moderationStatus: text("moderation_status").notNull().default("ACTIVE"),
  moderationReason: text("moderation_reason"),
  moderationType: text("moderation_type"),
  moderationUntil: timestamp("moderation_until", { withTimezone: true }),
  appealAllowed: boolean("appeal_allowed").notNull().default(false),
  moderatedAt: timestamp("moderated_at", { withTimezone: true }),
  moderatedBy: integer("moderated_by"),
  age: integer("age"),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  occupation: text("occupation"),
  position: text("position"),
  school: text("school"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const providerProfilesTable = pgTable("devicebridge_provider_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  providerType: text("provider_type").notNull(),
  operationLocation: text("operation_location").notNull(),
  shopName: text("shop_name"),
  shopLocation: text("shop_location"),
  description: text("description"),
  contact: text("contact"),
  verificationStatus: text("verification_status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const itemsTable = pgTable("devicebridge_items", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  brand: text("brand"),
  year: integer("year"),
  age: text("age"),
  condition: text("condition").notNull(),
  originalPrice: numeric("original_price", { precision: 12, scale: 2 }),
  salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
  location: text("location").notNull(),
  quantity: integer("quantity").notNull(),
  availableQuantity: integer("available_quantity").notNull(),
  offers: text("offers").array().notNull(),
  loanMaxDays: integer("loan_max_days"),
  depositRequired: boolean("deposit_required").notNull().default(false),
  donationAnnouncementDate: date("donation_announcement_date", { mode: "string" }),
  status: text("status").notNull().default("PROCESSING APPROVAL"),
  rejectionReason: text("rejection_reason"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const requestsTable = pgTable("devicebridge_requests", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id")
    .notNull()
    .references(() => itemsTable.id, { onDelete: "cascade" }),
  requesterId: integer("requester_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  purpose: text("purpose").notNull(),
  phone: text("phone"),
  icNumber: text("ic_number"),
  pickupLocation: text("pickup_location"),
  requestedDays: integer("requested_days"),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  meetingAt: timestamp("meeting_at", { withTimezone: true }),
  returnAt: timestamp("return_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: text("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
  status: text("status").notNull().default("PENDING"),
  agreementStatus: text("agreement_status"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const complaintsTable = pgTable("devicebridge_complaints", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  description: text("description").notNull(),
  phone: text("phone"),
  status: text("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messagesTable = pgTable("devicebridge_messages", {
  id: serial("id").primaryKey(),
  complaintId: integer("complaint_id")
    .notNull()
    .references(() => complaintsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  fromAdmin: boolean("from_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notificationsTable = pgTable("devicebridge_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const statusHistoryTable = pgTable("devicebridge_status_history", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id")
    .notNull()
    .references(() => itemsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userModerationTable = pgTable("devicebridge_user_moderation", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  adminId: integer("admin_id")
    .notNull()
    .references(() => usersTable.id),
  action: text("action").notNull(),
  durationType: text("duration_type").notNull(),
  reason: text("reason").notNull(),
  moderationUntil: timestamp("moderation_until", { withTimezone: true }),
  appealAllowed: boolean("appeal_allowed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userBlacklistTable = pgTable("devicebridge_user_blacklist", {
  id: serial("id").primaryKey(),
  icNumber: text("ic_number").notNull().unique(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  appealAllowed: boolean("appeal_allowed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userAppealsTable = pgTable("devicebridge_user_appeals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  status: text("status").notNull().default("PENDING"),
  adminNote: text("admin_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;