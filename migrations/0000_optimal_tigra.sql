CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guest` text NOT NULL,
	`photo` text NOT NULL,
	`action` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`guest`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`verification` text NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`expires` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`guest` text NOT NULL,
	`photo` text NOT NULL,
	PRIMARY KEY(`guest`, `photo`),
	FOREIGN KEY (`guest`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `guests` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created` integer NOT NULL,
	`notified` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guests_phone_unique` ON `guests` (`phone`);--> statement-breakpoint
CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`drive` text,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`preview` text,
	`published` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photos_drive_unique` ON `photos` (`drive`);--> statement-breakpoint
CREATE INDEX `photo_visibility` ON `photos` (`published`,`created`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`guest` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`guest`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_expiry` ON `sessions` (`expires`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
