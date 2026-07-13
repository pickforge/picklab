import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createDeferred,
  JsonRpcNdjsonBuffer,
  pumpJsonRpcNdjson,
  type JsonRpcMessage,
} from "../src/index.js";

function collectingWritable(
  chunks: Buffer[],
  write?: (chunk: Buffer) => Promise<void>,
): Writable {
  return new Writable({
    highWaterMark: 1,
    write(chunk: Buffer, _encoding, callback) {
      const bytes = Buffer.from(chunk);
      chunks.push(bytes);
      if (write === undefined) {
        callback();
        return;
      }
      void write(bytes).then(() => callback(), callback);
    },
  });
}

describe("createDeferred", () => {
  it("works when the runtime has no Promise.withResolvers", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Promise,
      "withResolvers",
    );
    let deferredPromise: Promise<string> | undefined;
    Reflect.deleteProperty(Promise, "withResolvers");
    try {
      const deferred = createDeferred<string>();
      deferred.resolve("ready");
      deferredPromise = deferred.promise;
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(Promise, "withResolvers", descriptor);
      }
    }
    if (deferredPromise === undefined) {
      throw new Error("deferred was not created");
    }
    await expect(deferredPromise).resolves.toBe("ready");
  });
});

describe("JsonRpcNdjsonBuffer", () => {
  it("buffers fragmented, coalesced, CRLF, and split multibyte records", () => {
    const decoder = new JsonRpcNdjsonBuffer();
    const first = '{ "jsonrpc": "2.0", "id": "café", "method": "tools/list" }\r\n';
    const second = '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}}\n';
    const bytes = Buffer.from(first + second);
    const split = Buffer.from("é").subarray(0, 1);
    const splitAt = bytes.indexOf(Buffer.from("é"));
    const records = [
      ...decoder.push(bytes.subarray(0, splitAt)),
      ...decoder.push(Buffer.concat([split, bytes.subarray(splitAt + 1, splitAt + 1)])),
      ...decoder.push(bytes.subarray(splitAt + 1)),
    ];

    expect(records).toHaveLength(2);
    expect(records[0]?.message.id).toBe("café");
    expect(records[0]?.raw.equals(Buffer.from(first))).toBe(true);
    expect(records[1]?.message.method).toBe("notifications/cancelled");
    expect(records[1]?.raw.equals(Buffer.from(second))).toBe(true);
    expect(() => decoder.end()).not.toThrow();
  });

  it("fails closed on malformed, invalid, empty, and incomplete records", () => {
    expect(() => new JsonRpcNdjsonBuffer().push("not-json\n")).toThrow(
      "malformed JSON-RPC record",
    );
    expect(() => new JsonRpcNdjsonBuffer().push('{"jsonrpc":"1.0"}\n')).toThrow(
      "expected a JSON-RPC 2.0 object",
    );
    expect(() => new JsonRpcNdjsonBuffer().push("\n")).toThrow(
      "empty JSON-RPC record",
    );
    const incomplete = new JsonRpcNdjsonBuffer();
    incomplete.push('{"jsonrpc":"2.0","method":"tools/list"}');
    expect(() => incomplete.end()).toThrow("incomplete JSON-RPC record");
  });

  it("rejects a fragmented record before pending memory exceeds its cap", () => {
    const decoder = new JsonRpcNdjsonBuffer(12);
    decoder.push("abcd");
    decoder.push("efgh");
    decoder.push("ijkl");
    expect(() => decoder.push("m")).toThrow(
      "JSON-RPC record exceeds 12 byte limit",
    );
  });
});

describe("pumpJsonRpcNdjson", () => {
  it("preserves exact bytes, IDs, cancellation, and out-of-order responses", async () => {
    const raw = [
      '{ "jsonrpc":"2.0", "id":1, "method":"tools/call" }\r\n',
      '{"jsonrpc":"2.0","id":"two","method":"tools/call"}\n',
      '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}\n',
      '{"jsonrpc":"2.0","id":"two","result":{"ok":true}}\n',
      '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n',
    ].join("");
    const output: Buffer[] = [];
    await pumpJsonRpcNdjson(
      Readable.from([Buffer.from(raw).subarray(0, 31), Buffer.from(raw).subarray(31)]),
      collectingWritable(output),
    );
    expect(Buffer.concat(output).toString()).toBe(raw);
  });

  it("serializes only when a hook transforms a message", async () => {
    const raw = '{ "jsonrpc":"2.0", "id":"x", "method":"tools/list" }\r\n';
    const unchanged: Buffer[] = [];
    await pumpJsonRpcNdjson(
      Readable.from([raw]),
      collectingWritable(unchanged),
      { hook: () => undefined },
    );
    expect(Buffer.concat(unchanged).toString()).toBe(raw);

    const transformed: Buffer[] = [];
    await pumpJsonRpcNdjson(
      Readable.from([raw]),
      collectingWritable(transformed),
      {
        hook: (message): JsonRpcMessage => ({
          ...message,
          params: { injected: true },
        }),
      },
    );
    expect(Buffer.concat(transformed).toString()).toBe(
      '{"jsonrpc":"2.0","id":"x","method":"tools/list","params":{"injected":true}}\n',
    );
  });

  it("waits for destination backpressure before forwarding the next record", async () => {
    const writes: string[] = [];
    const firstWriteStarted = createDeferred<void>();
    const releaseFirstWrite = createDeferred<void>();
    let writeCount = 0;
    const destination = collectingWritable([], async (chunk) => {
      writeCount += 1;
      if (writeCount === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      writes.push(chunk.toString());
    });
    const pumping = pumpJsonRpcNdjson(
      Readable.from([
        '{"jsonrpc":"2.0","id":1,"method":"one"}\n' +
          '{"jsonrpc":"2.0","id":2,"method":"two"}\n',
      ]),
      destination,
    );
    await firstWriteStarted.promise;
    expect(writeCount).toBe(1);
    expect(writes).toEqual([]);
    releaseFirstWrite.resolve();
    await pumping;
    expect(writeCount).toBe(2);
    expect(writes).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"one"}\n',
      '{"jsonrpc":"2.0","id":2,"method":"two"}\n',
    ]);
  });
});
