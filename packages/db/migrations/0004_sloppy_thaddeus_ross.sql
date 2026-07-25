CREATE TABLE "offer_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network_id" uuid NOT NULL,
	"offer_id" uuid,
	"placement_id" uuid,
	"external_offer_id" text,
	"offer_title" text,
	"user_token" text,
	"ip" "inet",
	"user_agent" text,
	"device_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_placement_id_wall_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."wall_placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_clicks_user_idx" ON "offer_clicks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "offer_clicks_offer_idx" ON "offer_clicks" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offer_clicks_network_idx" ON "offer_clicks" USING btree ("network_id","created_at");--> statement-breakpoint
CREATE INDEX "offer_clicks_token_idx" ON "offer_clicks" USING btree ("user_token");