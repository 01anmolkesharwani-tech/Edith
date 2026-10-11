/**
 * OPTIONAL, OFF BY DEFAULT: conservative SMTP recipient diagnostic.
 * Connects to the domain's MX, issues EHLO / MAIL FROM:<> / RCPT TO and QUIT.
 * It never sends DATA, so no message is ever sent. Results are diagnostic only:
 * many servers accept every recipient (catch-all) or defer, and outbound port 25 is
 * commonly blocked on home and cloud networks. A positive answer is NOT proof the mailbox exists.
 */
import net from "node:net";
import { randomBytes } from "node:crypto";
import type { CheckRecord } from "./validation";

export interface SmtpLine {
  code: number;
  text: string;
}

export interface SmtpConnection {
  read(): Promise<SmtpLine>;
  write(line: string): Promise<void>;
  close(): void;
}

export type SmtpConnector = (host: string, port: number, timeoutMs: number) => Promise<SmtpConnection>;

export const tcpConnector: SmtpConnector = (host, port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    let buffer = "";
    const waiters: ((l: SmtpLine) => void)[] = [];
    const lines: SmtpLine[] = [];
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        // Multi-line replies use "250-"; the final line uses "250 ".
        if (/^\d{3} /.test(raw) || /^\d{3}$/.test(raw)) {
          const line = { code: Number(raw.slice(0, 3)), text: raw.slice(4) };
          const w = waiters.shift();
          if (w) w(line);
          else lines.push(line);
        }
      }
    });
    socket.once("timeout", () => socket.destroy(new Error("SMTP timeout")));
    socket.once("error", (e) => reject(e));
    socket.once("connect", () =>
      resolve({
        read: () =>
          new Promise<SmtpLine>((res, rej) => {
            const l = lines.shift();
            if (l) return res(l);
            waiters.push(res);
            socket.once("error", rej);
            socket.once("close", () => rej(new Error("Connection closed")));
          }),
        write: (line) => new Promise<void>((res) => socket.write(`${line}\r\n`, () => res())),
        close: () => socket.end(),
      }),
    );
  });

const lastProbe = new Map<string, number>();

export async function smtpDiagnostic(
  email: string,
  mxHost: string,
  opts: { connector?: SmtpConnector; heloName?: string; timeoutMs?: number; minIntervalMs?: number } = {},
): Promise<CheckRecord> {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const minInterval = opts.minIntervalMs ?? 60_000;
  const last = lastProbe.get(domain) ?? 0;
  if (Date.now() - last < minInterval) {
    return { stage: "SMTP_DIAGNOSTIC", result: "SKIPPED", details: "Skipped: at most one diagnostic per domain per minute." };
  }
  lastProbe.set(domain, Date.now());
  const connector = opts.connector ?? tcpConnector;
  let conn: SmtpConnection | null = null;
  try {
    conn = await connector(mxHost, 25, opts.timeoutMs ?? 10_000);
    const greet = await conn.read();
    if (greet.code !== 220) return { stage: "SMTP_DIAGNOSTIC", result: "INCONCLUSIVE", details: `Server greeting ${greet.code}` };
    await conn.write(`EHLO ${opts.heloName ?? "localhost"}`);
    if ((await conn.read()).code !== 250) return { stage: "SMTP_DIAGNOSTIC", result: "INCONCLUSIVE", details: "EHLO not accepted" };
    await conn.write("MAIL FROM:<>");
    if ((await conn.read()).code !== 250) return { stage: "SMTP_DIAGNOSTIC", result: "INCONCLUSIVE", details: "MAIL FROM not accepted" };
    await conn.write(`RCPT TO:<${email}>`);
    const target = await conn.read();
    let random: SmtpLine | null = null;
    if (target.code >= 200 && target.code < 300) {
      await conn.write(`RCPT TO:<cr-${randomBytes(6).toString("hex")}@${domain}>`);
      random = await conn.read();
    }
    await conn.write("QUIT");
    if (target.code >= 500) {
      return { stage: "SMTP_DIAGNOSTIC", result: "FAIL", details: `Server rejected recipient: ${target.code} ${target.text}`.slice(0, 300) };
    }
    if (target.code >= 400) {
      return { stage: "SMTP_DIAGNOSTIC", result: "INCONCLUSIVE", details: `Temporary response ${target.code} (greylisting or rate limiting)` };
    }
    if (random && random.code >= 200 && random.code < 300) {
      return { stage: "SMTP_DIAGNOSTIC", result: "CATCH_ALL", details: "Server accepts arbitrary recipients (catch-all); mailbox cannot be confirmed." };
    }
    return {
      stage: "SMTP_DIAGNOSTIC",
      result: "INCONCLUSIVE",
      details: "Server accepted the recipient at RCPT stage. This is not proof that the mailbox exists or is read.",
    };
  } catch (e) {
    return { stage: "SMTP_DIAGNOSTIC", result: "ERROR", details: `Could not complete diagnostic: ${(e as Error).message}`.slice(0, 300) };
  } finally {
    conn?.close();
  }
}
