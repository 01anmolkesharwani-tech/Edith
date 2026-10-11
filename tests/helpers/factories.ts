import type { MailTransport, OutgoingMessage, TransportResult } from "@/lib/sending/transport";

/** Mock transport: records messages, never touches the network. */
export function mockTransport(behaviour: "accept" | "reject" | "auth-error" | "timeout" = "accept", delayMs = 0) {
  const sent: OutgoingMessage[] = [];
  const transport: MailTransport = {
    kind: "MOCK",
    async send(msg): Promise<TransportResult> {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      sent.push(msg);
      if (behaviour === "auth-error") throw Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
      if (behaviour === "timeout") throw Object.assign(new Error("Timeout"), { code: "ETIMEDOUT", command: "DATA" });
      if (behaviour === "reject") return { accepted: [], rejected: [msg.to.address], messageId: msg.messageId, response: "550 rejected" };
      return { accepted: [msg.to.address], rejected: [], messageId: msg.messageId, response: "250 OK" };
    },
  };
  return { transport, sent, factory: () => transport };
}
