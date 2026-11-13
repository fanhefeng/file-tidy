import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import jpeg from "jpeg-js";
import { resolveDateBucket } from "../src/core/date.js";
import { hashImages } from "../src/core/phash.js";

function fixture(dir, name, bytes) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, bytes);
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    ext: path.extname(name).slice(1),
    size: stat.size,
    birthtime: stat.birthtime,
    mtime: stat.mtime,
  };
}

async function withTrackedHandles(run, { failRead = false } = {}) {
  const opened = [];
  const originalOpen = fs.promises.open;
  fs.promises.open = async (...args) => {
    const handle = await originalOpen(...args);
    opened.push(handle);
    if (failRead)
      handle.read = async () => {
        throw Object.assign(new Error("injected read failure"), { code: "EIO" });
      };
    return handle;
  };
  try {
    await run();
    assert.ok(opened.length > 0, "the real EXIF filesystem reader was exercised");
    assert.ok(
      opened.every((handle) => handle.fd === -1),
      "every EXIF file handle must be closed before returning",
    );
  } finally {
    fs.promises.open = originalOpen;
    await Promise.all(opened.filter((handle) => handle.fd !== -1).map((handle) => handle.close()));
  }
}

async function withFixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tidy-exif-lifetime-"));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function jpegWithTiff(tiff) {
  const body = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(body.length + 2, 4);
  return Buffer.concat([header, body, Buffer.from([0xff, 0xd9])]);
}

function tiffHeader(length) {
  const tiff = Buffer.alloc(length);
  tiff.write("II");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  return tiff;
}

for (const failRead of [false, true]) {
  test(`EXIF date fallback closes its file after ${failRead ? "a read failure" : "a parsing failure"}`, async () => {
    await withFixture(async (dir) => {
      const file = fixture(dir, "broken.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 80, 0, 0]));
      await withTrackedHandles(
        async () => {
          assert.equal((await resolveDateBucket(file)).source, "fs");
        },
        { failRead },
      );
    });
  });
  test(`EXIF thumbnail fallback closes its file after ${failRead ? "a read failure" : "finding no thumbnail"}`, async () => {
    await withFixture(async (dir) => {
      const file = fixture(dir, "without-thumbnail.heic", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      await withTrackedHandles(
        async () => {
          assert.equal((await hashImages([file])).size, 0);
        },
        { failRead },
      );
    });
  });
}

test("EXIF capture dates are preserved and their file handles are closed", async () => {
  await withFixture(async (dir) => {
    const tiff = tiffHeader(64);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x8769, 10);
    tiff.writeUInt16LE(4, 12);
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt32LE(26, 18);
    tiff.writeUInt16LE(1, 26);
    tiff.writeUInt16LE(0x9003, 28);
    tiff.writeUInt16LE(2, 30);
    tiff.writeUInt32LE(20, 32);
    tiff.writeUInt32LE(44, 36);
    tiff.write("2026:07:01 12:00:00\0", 44);
    const file = fixture(dir, "capture.jpg", jpegWithTiff(tiff));
    await withTrackedHandles(async () => {
      assert.deepEqual(await resolveDateBucket(file), { bucket: "2026-07", source: "exif" });
    });
  });
});

test("embedded thumbnails are still hashed and their file handles are closed", async () => {
  await withFixture(async (dir) => {
    const thumbnail = jpeg.encode({ width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4, 180) }, 80).data;
    const tiff = tiffHeader(44 + thumbnail.length);
    tiff.writeUInt32LE(14, 10);
    tiff.writeUInt16LE(2, 14);
    tiff.writeUInt16LE(0x0201, 16);
    tiff.writeUInt16LE(4, 18);
    tiff.writeUInt32LE(1, 20);
    tiff.writeUInt32LE(44, 24);
    tiff.writeUInt16LE(0x0202, 28);
    tiff.writeUInt16LE(4, 30);
    tiff.writeUInt32LE(1, 32);
    tiff.writeUInt32LE(thumbnail.length, 36);
    thumbnail.copy(tiff, 44);
    const file = fixture(dir, "embedded.heic", jpegWithTiff(tiff));
    await withTrackedHandles(async () => {
      assert.equal(typeof (await hashImages([file])).get(file.path), "bigint");
    });
  });
});
