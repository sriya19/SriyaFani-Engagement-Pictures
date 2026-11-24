CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`upload_id` text,
	`status` text DEFAULT 'uploading' NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `video_visibility` ON `videos` (`published`,`status`,`created`);
