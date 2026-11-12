export const MAX_FRAME_BYTES = 8192;
export class JsonLines {
  private pending = Buffer.alloc(0);
  private decoder = new TextDecoder("utf-8", { fatal: true });
  constructor(
    private readonly receive: (frame: Record<string, unknown>) => void,
  ) {}
  feed(chunk: Buffer): void {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start),
        end = newline < 0 ? chunk.length : newline;
      if (this.pending.length + end - start + 1 > MAX_FRAME_BYTES)
        throw new Error("Control frame exceeds 8 KiB");
      this.pending = Buffer.concat([this.pending, chunk.subarray(start, end)]);
      if (newline < 0) return;
      const frame: unknown = JSON.parse(this.decoder.decode(this.pending));
      this.pending = Buffer.alloc(0);
      if (!frame || typeof frame !== "object" || Array.isArray(frame))
        throw new Error("Expected a JSON object");
      this.receive(frame as Record<string, unknown>);
      start = newline + 1;
    }
  }
  end(): void {
    if (this.pending.length) throw new Error("Incomplete control frame");
  }
}
export function encodeFrame(frame: object): Buffer {
  const data = Buffer.from(JSON.stringify(frame) + "\n");
  if (data.length > MAX_FRAME_BYTES)
    throw new Error("Control frame exceeds 8 KiB");
  return data;
}
