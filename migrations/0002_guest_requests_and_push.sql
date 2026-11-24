CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`delivery` text,
	`retry_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `push_owner` ON `push_subscriptions` (`owner`);--> statement-breakpoint
DROP INDEX `guests_phone_unique`;--> statement-breakpoint
ALTER TABLE `guests` ADD `phone_verified` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `guests_verified_phone` ON `guests` (`phone`) WHERE "guests"."phone_verified" = 1;