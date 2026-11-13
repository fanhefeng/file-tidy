import exifr from "exifr";

class FileReader extends exifr.fileReaders.get("fs") {
  async open() {
    if (this.fh !== undefined) return;
    this.fh = await this.fs.open(this.input, "r");
    // stat takes an options object, never the file path. Node 26 rejects
    // the legacy string argument used by exifr's built-in filesystem reader.
    this.size = (await this.fh.stat()).size;
  }
}

export function readExif(filePath, options) {
  return withFile(filePath, options, (parser) => parser.parse());
}

export function readExifThumbnail(filePath) {
  return withFile(filePath, exifr.thumbnailOnlyOptions, (parser) => parser.extractThumbnail());
}

async function withFile(filePath, options, extract) {
  const parser = new exifr.Exifr(options);
  const file = (parser.file = new FileReader(filePath, parser.options));
  const close = file.close.bind(file);
  let closing;
  // Own the reader before the first read: exifr's shortcuts can leak it on
  // read/parse failures or when no thumbnail exists. Keep chunked I/O, and
  // await the same close if exifr starts it before returning control to us.
  file.close = () => (closing ??= Promise.resolve(close()));
  try {
    await file.read();
    return await extract(parser);
  } finally {
    await file.close();
  }
}
