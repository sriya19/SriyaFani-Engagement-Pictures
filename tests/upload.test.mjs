import assert from "node:assert/strict";
import test from "node:test";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { planUpload, maxPhotoBytes } from "../album/upload-files.js";

test("Drive ZIPs and extracted folders preserve original bytes and report skipped files", async () => {
  const bytes = Uint8Array.of(255, 216, 255, 225, 4, 6, 7, 255, 217);
  const archive = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  await archive.add("engagement/look1/IMG_0001.JPG", new BlobReader(new Blob([bytes])));
  await archive.add("engagement/look2/IMG_0001.JPG", new BlobReader(new Blob([bytes])), { level: 0 });
  await archive.add("__MACOSX/._IMG_0001.JPG", new BlobReader(new Blob([bytes])));
  await archive.add("engagement/notes.txt", new BlobReader(new Blob(["hi"])));
  const batch = await planUpload([new File([await archive.close()], "Album.zip"), new File([bytes], "another.JPEG")]);
  try {
    assert.equal(batch.photos.length, 3);
    assert.equal(batch.skipped.length, 1);
    assert.match(batch.skipped[0], /notes.txt/);
    for (const item of batch.photos) {
      const file = await item.read();
      assert.equal(file.type, "image/jpeg");
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
    }
  } finally { await batch.close(); }
});

test("an unreadable ZIP and an oversized original do not prevent the other files from being selected", async () => {
  const batch = await planUpload([new File(["not a zip"], "broken.zip"),
    { name: "too-large.jpg", type: "image/jpeg", size: maxPhotoBytes + 1 }, new File(["valid"], "ok.png")]);
  try {
    assert.match(batch.skipped[0], /broken.zip/);
    await assert.rejects(batch.photos[0].read, /90 MiB/);
    assert.equal((await batch.photos[1].read()).name, "ok.png");
  } finally { await batch.close(); }
});
