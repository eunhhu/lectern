// A local cleartext HTTP/2 server that answers like APNs (P6-02 tests). Real Apple hosts are
// never contacted: tests point createApnsClient at `origin`.

import http2 from "node:http2";
import type { AddressInfo } from "node:net";

export interface FakeApnsRequest {
  path: string;
  headers: Record<string, string>;
  body: any;
}

export interface FakeApns {
  origin: string;
  requests: FakeApnsRequest[];
  /** Answer requests whose device token matches with `response`, `times` times (default: always). */
  respondWith(match: string | RegExp, response: { status: number; reason?: string }, times?: number): void;
  /** Connections the server accepted. */
  connections(): number;
  close(): Promise<void>;
}

interface Rule {
  match: string | RegExp;
  response: { status: number; reason?: string };
  left: number;
}

export async function startFakeApns(): Promise<FakeApns> {
  const requests: FakeApnsRequest[] = [];
  const rules: Rule[] = [];
  let connections = 0;
  const server = http2.createServer();
  const sessions = new Set<http2.ServerHttp2Session>();
  server.on("session", (session) => {
    connections += 1;
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  server.on("stream", (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
    let raw = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => (raw += chunk));
    stream.on("end", () => {
      const path = String(headers[":path"] ?? "");
      const flat: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) if (typeof value === "string") flat[key] = value;
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* keep the text */
      }
      requests.push({ path, headers: flat, body });
      const token = path.replace(/^\/3\/device\//, "");
      const rule = rules.find((r) => r.left > 0 && (typeof r.match === "string" ? token === r.match : r.match.test(token)));
      if (rule) rule.left -= 1;
      const response = rule?.response ?? { status: 200 };
      stream.respond({ ":status": response.status, "apns-id": crypto.randomUUID() });
      stream.end(response.reason ? JSON.stringify({ reason: response.reason }) : undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    respondWith(match, response, times = Number.POSITIVE_INFINITY) {
      rules.push({ match, response, left: times });
    },
    connections: () => connections,
    close() {
      for (const session of sessions) session.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
