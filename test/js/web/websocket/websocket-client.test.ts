import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, nodeExe } from "harness";
import * as path from "node:path";
function test(
  label: string,
  fn: (ws: WebSocket, done: (err?: unknown) => void) => void,
  timeout?: number,
  isOnly = false,
) {
  return makeTest(label, fn, timeout, isOnly);
}
test.only = (label, fn, timeout) => makeTest(label, fn, timeout, true);

const strings = [
  {
    label: "string (ascii)",
    message: "ascii",
    bytes: [0x61, 0x73, 0x63, 0x69, 0x69],
  },
  {
    label: "string (latin1)",
    message: "latin1-©",
    bytes: [0x6c, 0x61, 0x74, 0x69, 0x6e, 0x31, 0x2d, 0xc2, 0xa9],
  },
  {
    label: "string (utf-8)",
    message: "utf8-😶",
    bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x98, 0xb6],
  },
];

const buffers = [
  {
    label: "Uint8Array (utf-8)",
    message: new TextEncoder().encode("utf8-🙂"),
    bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x82],
  },
  {
    label: "ArrayBuffer (utf-8)",
    message: new TextEncoder().encode("utf8-🙃").buffer,
    bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x83],
  },
  {
    label: "Buffer (utf-8)",
    message: Buffer.from("utf8-🤩"),
    bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0xa4, 0xa9],
  },
];

const messages = [...strings, ...buffers];

const binaryTypes = [
  {
    label: "nodebuffer",
    type: Buffer,
  },
  {
    label: "arraybuffer",
    type: ArrayBuffer,
  },
] as const;

let servers: Subprocess[] = [];
let clients: WebSocket[] = [];

function cleanUp() {
  for (const client of clients) {
    client.terminate();
  }
  for (const server of servers) {
    server.kill();
  }
}

beforeEach(cleanUp);
afterEach(cleanUp);

describe("WebSocket", () => {
  test("url", (ws, done) => {
    expect(ws.url).toStartWith("ws://");
    done();
  });
  test("readyState", (ws, done) => {
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.addEventListener("open", () => {
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
    ws.addEventListener("close", () => {
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      done();
    });
  });
  describe("binaryType", () => {
    test("(default)", (ws, done) => {
      expect(ws.binaryType).toBe("nodebuffer");
      done();
    });
    test("(invalid)", (ws, done) => {
      try {
        // @ts-expect-error
        ws.binaryType = "invalid";
        done(new Error("Expected an error"));
      } catch {
        done();
      }
    });
    for (const { label, type } of binaryTypes) {
      test(label, (ws, done) => {
        ws.binaryType = label;
        ws.addEventListener("open", () => {
          expect(ws.binaryType).toBe(label);
          ws.send(new Uint8Array(1));
        });
        ws.addEventListener("message", ({ data }) => {
          expect(data).toBeInstanceOf(type);
          ws.ping();
        });
        ws.addEventListener("ping", ({ data }) => {
          expect(data).toBeInstanceOf(type);
          ws.pong();
        });
        ws.addEventListener("pong", ({ data }) => {
          expect(data).toBeInstanceOf(type);
          done();
        });
      });
    }
  });
  describe("send()", () => {
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.send(message);
        });
        ws.addEventListener("message", ({ data }) => {
          if (typeof data === "string") {
            expect(data).toBe(message);
          } else {
            expect(data).toEqual(Buffer.from(bytes));
          }
          done();
        });
      });
    }
  });
  describe("ping()", () => {
    test("(no argument)", (ws, done) => {
      ws.addEventListener("open", () => {
        ws.ping();
      });
      ws.addEventListener("ping", ({ data }) => {
        expect(data).toBeInstanceOf(Buffer);
        done();
      });
    });
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.ping(message);
        });
        ws.addEventListener("ping", ({ data }) => {
          expect(data).toEqual(Buffer.from(bytes));
          done();
        });
      });
    }
  });
  describe("pong()", () => {
    test("(no argument)", (ws, done) => {
      ws.addEventListener("open", () => {
        ws.pong();
      });
      ws.addEventListener("pong", ({ data }) => {
        expect(data).toBeInstanceOf(Buffer);
        done();
      });
    });
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.pong(message);
        });
        ws.addEventListener("pong", ({ data }) => {
          expect(data).toEqual(Buffer.from(bytes));
          done();
        });
      });
    }
  });
  describe("close()", () => {
    test("(no arguments)", (ws, done) => {
      ws.addEventListener("open", () => {
        ws.close();
      });
      ws.addEventListener("close", ({ code, reason, wasClean }) => {
        expect(code).toBe(1000);
        expect(reason).toBeString();
        expect(wasClean).toBeTrue();
        done();
      });
    });
    test("(no reason)", (ws, done) => {
      ws.addEventListener("open", () => {
        ws.close(1001);
      });
      ws.addEventListener("close", ({ code, reason, wasClean }) => {
        expect(code).toBe(1001);
        expect(reason).toBeString();
        expect(wasClean).toBeTrue();
        done();
      });
    });
    // FIXME: Encoding issue
    // Expected: "latin1-©"
    // Received: "latin1-Â©"
    /*
    for (const { label, message } of strings) {
      test(label, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.close(1002, message);
        });
        ws.addEventListener("close", ({ code, reason, wasClean }) => {
          expect(code).toBe(1002);
          expect(reason).toBe(message);
          expect(wasClean).toBeTrue();
          done();
        });
      });
    }
    */
  });
  test("terminate()", (ws, done) => {
    ws.addEventListener("open", () => {
      ws.terminate();
    });
    ws.addEventListener("close", ({ code, reason, wasClean }) => {
      expect(code).toBe(1006);
      expect(reason).toBeString();
      expect(wasClean).toBeFalse();
      done();
    });
  });
});

function makeTest(
  label: string,
  fn: (ws: WebSocket, done: (err?: unknown) => void) => void,
  timeout?: number,
  isOnly = false,
) {
  return (isOnly ? it.only : it)(
    label,
    testDone => {
      let isDone = false;
      const done = (err?: unknown) => {
        if (!isDone) {
          isDone = true;
          testDone(err);
        }
      };
      listen()
        .then(url => {
          const ws = new WebSocket(url);
          clients.push(ws);
          fn(ws, done);
        })
        .catch(done);
    },
    { timeout: timeout ?? 1000 },
  );
}

async function listen(): Promise<URL> {
  const pathname = path.join(import.meta.dir, "./websocket-server-echo.mjs");
  const { promise, resolve, reject } = Promise.withResolvers();
  const server = spawn({
    cmd: [nodeExe() ?? bunExe(), pathname],
    cwd: import.meta.dir,
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    serialization: "json",
    ipc(message) {
      const url = message?.href;
      if (url) {
        try {
          resolve(new URL(url));
        } catch (error) {
          reject(error);
        }
      }
    },
  });

  servers.push(server);

  return await promise;
}
