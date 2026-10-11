import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type Tx = Prisma.TransactionClient | typeof db;

export async function logActivity(
  tx: Tx,
  data: {
    profileId: string;
    contactId: string;
    type: string;
    summary: string;
    source?: "PROVIDER" | "INBOX" | "MANUAL" | "SYSTEM";
    details?: unknown;
    fromStage?: Prisma.OutreachActivityCreateInput["fromStage"];
    toStage?: Prisma.OutreachActivityCreateInput["toStage"];
    draftId?: string | null;
    sendLogId?: string | null;
    occurredAt?: Date;
  },
) {
  return tx.outreachActivity.create({
    data: {
      profileId: data.profileId,
      contactId: data.contactId,
      type: data.type,
      summary: data.summary.slice(0, 500),
      source: data.source ?? "SYSTEM",
      details: data.details === undefined ? null : JSON.stringify(data.details),
      fromStage: data.fromStage ?? null,
      toStage: data.toStage ?? null,
      draftId: data.draftId ?? null,
      sendLogId: data.sendLogId ?? null,
      occurredAt: data.occurredAt ?? new Date(),
    },
  });
}
