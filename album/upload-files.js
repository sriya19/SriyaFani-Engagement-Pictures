const mimeByExtension = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", jfif: "image/jpeg",
  png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
  heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
};
const types = new Set(Object.values(mimeByExtension));
export const maxPhotoBytes = 90 * 1024 * 1024;
function mimeFor(name, fallback) {
  return mimeByExtension[name.split(".").at(-1)?.toLowerCase()] || (types.has(fallback) ? fallback : "");
}
function validateSize(size) {
  if (!Number.isSafeInteger(size) || size < 1 || size > maxPhotoBytes)
    throw new Error("Choose a nonempty photo up to 90 MiB, or use direct Drive import.");
}
async function extract(entry, name, type) {
  validateSize(entry.uncompressedSize);
  if (entry.encrypted) throw new Error("Unzip this password-protected archive on your device first.");
  const chunks = [];
  let length = 0;
  await entry.getData(new WritableStream({
    write(chunk) {
      length += chunk.byteLength;
      if (length > entry.uncompressedSize || length > maxPhotoBytes) throw new Error("Invalid uncompressed photo size.");
      chunks.push(chunk);
    },
  }), { checkSignature: true, useWebWorkers: false });
  if (length !== entry.uncompressedSize) throw new Error("Incomplete photo in the ZIP.");
  return new File(chunks, name, { type });
}
export async function planUpload(files) {
  const photos = [], skipped = [], readers = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (path.split(/[\\/]/).some((piece) => piece.startsWith("." ) || piece === "__MACOSX")) continue;
    if (/\.zip$/i.test(file.name) || ["application/zip", "application/x-zip-compressed"].includes(file.type)) {
      try {
        const { ZipReader, BlobReader } = await import("@zip.js/zip.js");
        const reader = new ZipReader(new BlobReader(file));
        readers.push(reader);
        const entries = await reader.getEntries();
        for (const entry of entries) {
          const pieces = entry.filename.split(/[\\/]/);
          if (entry.directory || pieces.some((p) => p.startsWith(".") || p === "__MACOSX")) continue;
          const name = pieces.at(-1), type = mimeFor(name);
          const label = path + " / " + entry.filename;
          if (!type) { skipped.push(label + " — unsupported file type"); continue; }
          photos.push({ label, read: () => extract(entry, name, type) });
        }
      } catch {
        skipped.push(path + " — ZIP could not be opened. Download it again or select its extracted folder.");
      }
    } else {
      const type = mimeFor(file.name, file.type);
      if (!type) { skipped.push(path + " — unsupported file type"); continue; }
      photos.push({ label: path, read: async () => {
        validateSize(file.size);
        return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
      } });
    }
  }
  return { photos, skipped, close: () => Promise.all(readers.map((reader) => reader.close())) };
}
