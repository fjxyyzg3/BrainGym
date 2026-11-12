import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JsonLines,
  encodeFrame,
  MAX_FRAME_BYTES,
} from "../src/server/json-lines.js";

test("JSON Lines preserves split UTF-8, handles multiple frames and includes newline in the byte limit", () => {
  const frames: Record<string, unknown>[] = [];
  const reader = new JsonLines((frame) => frames.push(frame));
  const unicode = encodeFrame({ message: "状态恢复" });
  for (const byte of unicode) reader.feed(Buffer.from([byte]));
  reader.feed(Buffer.from('{"a":1}\n{"b":2}\n'));
  const maximum = encodeFrame({ x: "a".repeat(MAX_FRAME_BYTES - 9) });
  assert.equal(maximum.length, MAX_FRAME_BYTES);
  reader.feed(maximum);
  reader.end();
  assert.deepEqual(frames.slice(0, 3), [
    { message: "状态恢复" },
    { a: 1 },
    { b: 2 },
  ]);
  assert.equal(String(frames[3].x).length, MAX_FRAME_BYTES - 9);
  assert.throws(() => encodeFrame({ x: "中".repeat(3000) }), /8 KiB/);
});

test("JSON Lines rejects overlong, incomplete, invalid UTF-8 and non-object frames", () => {
  for (const bytes of [
    Buffer.alloc(MAX_FRAME_BYTES, 32),
    Buffer.from("[]\n"),
    Buffer.from("null\n"),
    Buffer.from("\n"),
    Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125, 10]),
  ]) {
    assert.throws(() => new JsonLines(() => {}).feed(bytes));
  }
  const incomplete = new JsonLines(() => {});
  incomplete.feed(Buffer.from('{"a":1}'));
  assert.throws(() => incomplete.end(), /Incomplete/);
});
