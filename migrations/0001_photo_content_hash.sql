ALTER TABLE `photos` ADD `sha256` text;--> statement-breakpoint
CREATE UNIQUE INDEX `photos_sha256_unique` ON `photos` (`sha256`);