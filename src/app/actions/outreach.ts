"use server";

import { redirect } from "next/navigation";
import { bool, run, str, type ActionState } from "@/lib/action-utils";
import { activeProfileId } from "@/lib/session";
import { checkReadiness, resolveUnknownSend, sendDraft, type SendResult } from "@/lib/sending/send";
import { cancelDraft, createDraft, markReviewed, regenerateDraft, setAcknowledgements, updateDraft } from "@/lib/services/drafts";
import { draftFollowUp, rescheduleFollowUp, skipFollowUp } from "@/lib/services/followups";
import { logBounceManually, logReplyManually, syncReplies } from "@/lib/services/replies";
import { addSuppression, removeSuppression } from "@/lib/services/suppression";
import { deleteTemplate, saveTemplate } from "@/lib/services/templates";

export async function createDraftAction(fd: FormData) {
  const d = await createDraft(await activeProfileId(), str(fd, "contactId"), {
    opportunityId: str(fd, "opportunityId") || null,
    templateId: str(fd, "templateId") || null,
  });
  redirect(`/drafts/${d.id}`);
}

export async function regenerateDraftAction(draftId: string, templateId?: string | null) {
  return run(async () => regenerateDraft(await activeProfileId(), draftId, templateId), "Draft regenerated with alternative wording.");
}

export async function saveDraftAction(
  draftId: string,
  input: { subject: string; body: string; recipientEmail: string; resumeId: string | null; opportunityId: string | null },
) {
  return run(async () => updateDraft(await activeProfileId(), draftId, input), "Draft saved.");
}

export async function markReviewedAction(draftId: string, hash: string) {
  return run(async () => markReviewed(await activeProfileId(), draftId, hash));
}

export async function acknowledgeAction(draftId: string, ack: { guess?: boolean; duplicate?: boolean }) {
  return run(async () => setAcknowledgements(await activeProfileId(), draftId, ack));
}

export async function readinessAction(draftId: string) {
  return run(async () => checkReadiness(await activeProfileId(), draftId));
}

/** The only path that sends email: an explicit user click on "Send email" for a reviewed draft. */
export async function sendDraftAction(draftId: string, expectedHash: string): Promise<ActionState<SendResult>> {
  return run(async () => sendDraft(await activeProfileId(), draftId, expectedHash));
}

export async function resolveUnknownAction(draftId: string, wasSent: boolean) {
  return run(async () => resolveUnknownSend(await activeProfileId(), draftId, wasSent), wasSent ? "Recorded as sent." : "Recorded as not sent.");
}

export async function cancelDraftAction(fd: FormData) {
  await cancelDraft(await activeProfileId(), str(fd, "id"));
  redirect("/drafts");
}

export async function saveTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    async () =>
      saveTemplate(
        await activeProfileId(),
        { name: str(fd, "name"), recipientType: str(fd, "recipientType") as never, subjectTemplates: str(fd, "subjectTemplates"), bodyTemplate: str(fd, "bodyTemplate") },
        str(fd, "id") || undefined,
      ),
    "Template saved.",
  );
}

export async function deleteTemplateAction(fd: FormData) {
  await deleteTemplate(await activeProfileId(), str(fd, "id"));
  redirect("/drafts/templates");
}

export async function draftFollowUpAction(fd: FormData) {
  const d = await draftFollowUp(await activeProfileId(), str(fd, "id"));
  redirect(`/drafts/${d.id}`);
}

export async function followUpStateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const profileId = await activeProfileId();
    if (str(fd, "op") === "skip") await skipFollowUp(profileId, str(fd, "id"), str(fd, "reason") || "Skipped by you");
    else await rescheduleFollowUp(profileId, str(fd, "id"), new Date(str(fd, "dueDate")));
  }, "Follow-up updated.");
}

export async function logReplyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const profileId = await activeProfileId();
    if (str(fd, "kind") === "bounce") await logBounceManually(profileId, str(fd, "sendLogId"), str(fd, "note") || null);
    else await logReplyManually(profileId, str(fd, "sendLogId"), str(fd, "note") || null, str(fd, "at") ? new Date(str(fd, "at")) : undefined);
  }, "Recorded (manual).");
}

export async function syncRepliesAction(): Promise<ActionState> {
  return run(async () => syncReplies(await activeProfileId()), (r) => `Checked ${r.checked} inbox message(s): ${r.replies} reply(ies), ${r.bounces} bounce(s) matched.`);
}

export async function addSuppressionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => addSuppression(await activeProfileId(), { value: str(fd, "value"), reason: str(fd, "reason"), global: bool(fd, "global") }), "Added to the Do Not Contact list.");
}

export async function removeSuppressionAction(fd: FormData) {
  await removeSuppression(await activeProfileId(), str(fd, "id"));
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/settings");
}
