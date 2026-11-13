/** Read only requested tags, with bounded file handles and no artwork/duration decoding. */
export async function readAudioMetadata(files, { concurrency = 4, onProgress = () => {} } = {}) {
  const results = new Map();
  if (!files.length) return results;
  const { parseFile } = await import("music-metadata");
  const workerCount = Number.isFinite(concurrency) ? Math.max(1, Math.min(16, Math.trunc(concurrency))) : 4;
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(workerCount, files.length) }, async () => {
      while (next < files.length) {
        const file = files[next++];
        try {
          const { common } = await parseFile(file.path, {
            duration: false,
            skipCovers: true,
            skipPostHeaders: false,
            maxMemoryAllocation: 4 * 1024 * 1024,
            maxMetadataEntries: 1000,
          });
          const tags = {};
          for (const [field, value] of Object.entries({
            artist: common.artist ?? common.artists?.[0],
            albumArtist: common.albumartist,
            album: common.album,
            title: common.title,
            genre: common.genre?.[0],
            year: common.year,
          })) {
            if ((typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value)))
              tags[field] = String(value);
          }
          results.set(file.path, { tags, status: Object.keys(tags).length ? "read" : "missing" });
        } catch {
          // An absent/corrupt tag never aborts a batch or changes the original filename.
          results.set(file.path, { tags: {}, status: "unreadable" });
        }
        onProgress(++done);
      }
    }),
  );
  return results;
}
