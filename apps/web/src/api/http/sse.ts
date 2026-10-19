// A server-sent events reader over a fetch() response body (the WHATWG event-stream
// format). The workspace stream and the 물어보기 answer stream both use it: EventSource
// cannot POST, cannot send Last-Event-ID on a fresh connection, and hides the status of a
// failed response, which decides between "sign in again", "not ready yet" and "retry".

export interface SseMessage {
  /** The last `id:` seen on the stream so far (it carries over to later messages). */
  id: string | null;
  /** `event:` of the message, "message" when absent. */
  event: string;
  data: string;
}

/** Incremental parser: feed decoded text, get complete messages back. */
export class SseParser {
  #buffer = "";
  #data: string[] = [];
  #event = "";
  #lastId: string | null = null;
  #sawData = false;
  /** Last `retry:` value in ms, if the server sent one. */
  retry: number | null = null;

  push(text: string): SseMessage[] {
    this.#buffer += text;
    const out: SseMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.#buffer.length; i++) {
      const ch = this.#buffer[i];
      if (ch !== "\n" && ch !== "\r") continue;
      // A lone \r at the end may be the first half of \r\n: wait for more text.
      if (ch === "\r" && i === this.#buffer.length - 1) break;
      const line = this.#buffer.slice(start, i);
      if (ch === "\r" && this.#buffer[i + 1] === "\n") i++;
      start = i + 1;
      const message = this.#line(line);
      if (message) out.push(message);
    }
    this.#buffer = this.#buffer.slice(start);
    return out;
  }

  /** The message left unterminated when the stream ends, if any (per spec it is dropped). */
  end(): void {
    this.#buffer = "";
    this.#reset();
  }

  #line(line: string): SseMessage | null {
    if (line === "") {
      if (!this.#sawData) {
        this.#reset();
        return null;
      }
      const message = { id: this.#lastId, event: this.#event || "message", data: this.#data.join("\n") };
      this.#reset();
      return message;
    }
    if (line.startsWith(":")) return null; // comment (heartbeat)
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        this.#data.push(value);
        this.#sawData = true;
        break;
      case "event":
        this.#event = value;
        break;
      case "id":
        if (!value.includes("\0")) this.#lastId = value || null;
        break;
      case "retry":
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break;
    }
    return null;
  }

  #reset() {
    this.#data = [];
    this.#event = "";
    this.#sawData = false;
  }
}

/** Reads `body` to the end, yielding each message. Aborting the fetch ends the loop with an AbortError. */
export async function* readSse(body: ReadableStream<Uint8Array>, parser = new SseParser()): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let first = true;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let text = decoder.decode(value, { stream: true });
      if (first && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      first = false;
      yield* parser.push(text);
    }
    yield* parser.push(decoder.decode());
    parser.end();
  } finally {
    reader.releaseLock();
  }
}
