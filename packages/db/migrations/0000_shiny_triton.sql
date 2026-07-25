CREATE TYPE "public"."actor_type" AS ENUM('user', 'admin', 'system', 'provider');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('viewer', 'reviewer', 'superadmin');--> statement-breakpoint
CREATE TYPE "public"."auth_event_kind" AS ENUM('signup', 'login', 'login_failed', 'logout', 'password_reset_requested', 'password_reset_completed', 'email_verified');--> statement-breakpoint
CREATE TYPE "public"."completion_kind" AS ENUM('credit', 'screenout', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."completion_status" AS ENUM('received', 'pending_review', 'credited', 'rejected', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('desktop', 'mobile', 'tablet');--> statement-breakpoint
CREATE TYPE "public"."fraud_subject_type" AS ENUM('signup', 'login', 'completion', 'payout');--> statement-breakpoint
CREATE TYPE "public"."fraud_verdict" AS ENUM('allow', 'review', 'deny', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_status" AS ENUM('pending', 'posted', 'rejected', 'void');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('earn', 'screenout', 'reversal', 'redeem', 'redeem_refund', 'manual_adjustment', 'bonus', 'referral_bonus', 'referral_commission');--> statement-breakpoint
CREATE TYPE "public"."network_kind" AS ENUM('survey_wall', 'offer_wall');--> statement-breakpoint
CREATE TYPE "public"."offer_category" AS ENUM('survey', 'app_install', 'signup', 'purchase', 'game', 'video', 'other');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('paypal', 'upi', 'giftcard', 'crypto');--> statement-breakpoint
CREATE TYPE "public"."payout_state" AS ENUM('requested', 'under_review', 'approved', 'processing', 'paid', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."postback_dedupe_outcome" AS ENUM('new', 'duplicate', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."postback_parse_status" AS ENUM('ok', 'unknown_network', 'bad_signature', 'malformed', 'unknown_user');--> statement-breakpoint
CREATE TYPE "public"."review_resolution" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."ticket_kind" AS ENUM('missing_points', 'payout_issue', 'account', 'other');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'awaiting_user', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"attempted_email" text,
	"kind" "auth_event_kind" NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"device_fingerprint" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"device_type" "device_type",
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"display_name" text,
	"country" text,
	"referral_code" text NOT NULL,
	"referred_by_user_id" uuid,
	"signup_ip" "inet",
	"signup_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_admin_id" uuid
);
--> statement-breakpoint
CREATE TABLE "settings_versions" (
	"version" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"previous_value" jsonb,
	"value" jsonb NOT NULL,
	"changed_by_admin_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "network_kind" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revenue_share_bps" integer DEFAULT 3500 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ref" text,
	"adapter_version" integer DEFAULT 1 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_postback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"external_offer_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"requirements" text,
	"category" "offer_category" DEFAULT 'other' NOT NULL,
	"icon_url" text,
	"gross_usd_micros" bigint NOT NULL,
	"points" bigint NOT NULL,
	"config_version" bigint DEFAULT 0 NOT NULL,
	"url_template" text NOT NULL,
	"countries" text[],
	"excluded_countries" text[],
	"devices" text[],
	"estimated_minutes" integer,
	"conversion_rate_bps" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "wall_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url_template" text NOT NULL,
	"signing_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"countries" text[],
	"excluded_countries" text[],
	"devices" text[],
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"external_transaction_id" text NOT NULL,
	"kind" "completion_kind" NOT NULL,
	"reversal_event_id" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"user_token_raw" text,
	"offer_id" uuid,
	"external_offer_id" text,
	"gross_usd_micros" bigint NOT NULL,
	"points_awarded" bigint DEFAULT 0 NOT NULL,
	"config_version" bigint DEFAULT 0 NOT NULL,
	"status" "completion_status" DEFAULT 'received' NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" text,
	"adapter_version" bigint DEFAULT 1 NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "postback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid,
	"network_key_raw" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"remote_ip" "inet",
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query_string" text,
	"headers" jsonb,
	"raw_body" "bytea",
	"signature_valid" boolean,
	"parse_status" "postback_parse_status" NOT NULL,
	"parse_error" text,
	"dedupe_outcome" "postback_dedupe_outcome" NOT NULL,
	"completion_id" uuid,
	"handled_in_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_points" bigint NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"status" "ledger_entry_status" DEFAULT 'posted' NOT NULL,
	"idempotency_key" text NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"network_id" uuid,
	"completion_id" uuid,
	"payout_id" uuid,
	"referral_id" uuid,
	"reverses_entry_id" uuid,
	"external_transaction_id" text,
	"config_version" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	CONSTRAINT "ledger_entries_amount_nonzero" CHECK (amount_points <> 0),
	CONSTRAINT "ledger_entries_sign_matches_type" CHECK ((
        (type IN ('earn','screenout','bonus','referral_bonus','referral_commission','redeem_refund') AND amount_points > 0)
        OR (type IN ('reversal','redeem') AND amount_points < 0)
        OR (type = 'manual_adjustment')
      )),
	CONSTRAINT "ledger_entries_reversal_has_target" CHECK ((type <> 'reversal') OR (reverses_entry_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payout_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"from_state" "payout_state",
	"to_state" "payout_state" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_points" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"config_version" bigint DEFAULT 0 NOT NULL,
	"method" "payout_method" NOT NULL,
	"destination_masked" text NOT NULL,
	"destination_hash" text NOT NULL,
	"state" "payout_state" DEFAULT 'requested' NOT NULL,
	"provider_key" text,
	"provider_reference" text,
	"provider_payload" jsonb,
	"reserve_entry_id" uuid,
	"refund_entry_id" uuid,
	"idempotency_key" text NOT NULL,
	"requested_ip" "inet",
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_admin_id" uuid,
	"settled_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "fraud_check_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"check_key" text NOT NULL,
	"verdict" "fraud_verdict" NOT NULL,
	"score_delta" integer DEFAULT 0 NOT NULL,
	"details" jsonb,
	"duration_ms" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "fraud_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "fraud_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid,
	"verdict" "fraud_verdict" NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"config_version" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "fraud_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid,
	"evaluation_id" uuid,
	"reason" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"state" "review_state" DEFAULT 'open' NOT NULL,
	"resolution" "review_resolution",
	"resolved_by_admin_id" uuid,
	"resolved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"claim_date" date NOT NULL,
	"streak_day" integer DEFAULT 1 NOT NULL,
	"points_awarded" bigint NOT NULL,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referee_user_id" uuid NOT NULL,
	"code_used" text NOT NULL,
	"attributed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualified_at" timestamp with time zone,
	"bonus_entry_id" uuid,
	"lifetime_commission_points" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_admin_id" uuid,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "ticket_kind" NOT NULL,
	"subject" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"network_id" uuid,
	"external_transaction_id" text,
	"claimed_offer_name" text,
	"completed_at" timestamp with time zone,
	"attachments" jsonb,
	"assigned_admin_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_versions" ADD CONSTRAINT "settings_versions_changed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("changed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wall_placements" ADD CONSTRAINT "wall_placements_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postback_events" ADD CONSTRAINT "postback_events_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_completion_id_completions_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."completions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_entry_id_ledger_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_transitions" ADD CONSTRAINT "payout_transitions_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_reserve_entry_id_ledger_entries_id_fk" FOREIGN KEY ("reserve_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_refund_entry_id_ledger_entries_id_fk" FOREIGN KEY ("refund_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_decided_by_admin_id_admin_users_id_fk" FOREIGN KEY ("decided_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_check_results" ADD CONSTRAINT "fraud_check_results_evaluation_id_fraud_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."fraud_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_evaluations" ADD CONSTRAINT "fraud_evaluations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_evaluation_id_fraud_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."fraud_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_resolved_by_admin_id_admin_users_id_fk" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_claims" ADD CONSTRAINT "daily_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_claims" ADD CONSTRAINT "daily_claims_entry_id_ledger_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_user_id_users_id_fk" FOREIGN KEY ("referee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_bonus_entry_id_ledger_entries_id_fk" FOREIGN KEY ("bonus_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_admin_id_admin_users_id_fk" FOREIGN KEY ("author_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_admin_id_admin_users_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_uq" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_log_admin_idx" ON "audit_log" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "auth_events_user_idx" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_ip_idx" ON "auth_events" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_fingerprint_idx" ON "auth_events" USING btree ("device_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_uq" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_devices_user_fingerprint_uq" ON "user_devices" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "user_devices_fingerprint_idx" ON "user_devices" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uq" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by_user_id");--> statement-breakpoint
CREATE INDEX "users_signup_ip_idx" ON "users" USING btree ("signup_ip");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "settings_versions_key_idx" ON "settings_versions" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "networks_key_uq" ON "networks" USING btree ("key");--> statement-breakpoint
CREATE INDEX "networks_enabled_idx" ON "networks" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_network_external_uq" ON "offers" USING btree ("network_id","external_offer_id");--> statement-breakpoint
CREATE INDEX "offers_feed_idx" ON "offers" USING btree ("is_active","category","points");--> statement-breakpoint
CREATE INDEX "offers_network_idx" ON "offers" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "wall_placements_network_idx" ON "wall_placements" USING btree ("network_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "completions_dedupe_uq" ON "completions" USING btree ("network_id","external_transaction_id","kind","reversal_event_id");--> statement-breakpoint
CREATE INDEX "completions_user_idx" ON "completions" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "completions_status_idx" ON "completions" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "completions_network_idx" ON "completions" USING btree ("network_id","received_at");--> statement-breakpoint
CREATE INDEX "completions_txn_idx" ON "completions" USING btree ("external_transaction_id");--> statement-breakpoint
CREATE INDEX "postback_events_network_idx" ON "postback_events" USING btree ("network_id","received_at");--> statement-breakpoint
CREATE INDEX "postback_events_outcome_idx" ON "postback_events" USING btree ("dedupe_outcome","received_at");--> statement-breakpoint
CREATE INDEX "postback_events_completion_idx" ON "postback_events" USING btree ("completion_id");--> statement-breakpoint
CREATE INDEX "postback_events_ip_idx" ON "postback_events" USING btree ("remote_ip","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_uq" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_balance_idx" ON "ledger_entries" USING btree ("user_id","available_at") WHERE status = 'posted';--> statement-breakpoint
CREATE INDEX "ledger_entries_user_history_idx" ON "ledger_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_completion_idx" ON "ledger_entries" USING btree ("completion_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_payout_idx" ON "ledger_entries" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_reverses_idx" ON "ledger_entries" USING btree ("reverses_entry_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_status_idx" ON "ledger_entries" USING btree ("status") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "ledger_entries_external_txn_idx" ON "ledger_entries" USING btree ("external_transaction_id");--> statement-breakpoint
CREATE INDEX "payout_transitions_payout_idx" ON "payout_transitions" USING btree ("payout_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_idempotency_uq" ON "payouts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payouts_user_idx" ON "payouts" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "payouts_state_idx" ON "payouts" USING btree ("state","requested_at");--> statement-breakpoint
CREATE INDEX "payouts_destination_hash_idx" ON "payouts" USING btree ("destination_hash");--> statement-breakpoint
CREATE INDEX "payouts_provider_ref_idx" ON "payouts" USING btree ("provider_reference");--> statement-breakpoint
CREATE INDEX "fraud_check_results_eval_idx" ON "fraud_check_results" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "fraud_check_results_key_idx" ON "fraud_check_results" USING btree ("check_key","verdict");--> statement-breakpoint
CREATE INDEX "fraud_evaluations_subject_idx" ON "fraud_evaluations" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "fraud_evaluations_user_idx" ON "fraud_evaluations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "fraud_evaluations_verdict_idx" ON "fraud_evaluations" USING btree ("verdict","created_at");--> statement-breakpoint
CREATE INDEX "review_items_queue_idx" ON "review_items" USING btree ("state","priority","created_at");--> statement-breakpoint
CREATE INDEX "review_items_subject_idx" ON "review_items" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "review_items_user_idx" ON "review_items" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_claims_user_date_uq" ON "daily_claims" USING btree ("user_id","claim_date");--> statement-breakpoint
CREATE INDEX "daily_claims_user_idx" ON "daily_claims" USING btree ("user_id","claim_date");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_uq" ON "referrals" USING btree ("referee_user_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_user_id");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_user_idx" ON "tickets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "tickets" USING btree ("status","kind","created_at");--> statement-breakpoint
CREATE INDEX "tickets_txn_idx" ON "tickets" USING btree ("external_transaction_id");