import { notFound } from "next/navigation";
import {
  acknowledgeAction,
  cancelDraftAction,
  markReviewedAction,
  readinessAction,
  regenerateDraftAction,
  resolveUnknownAction,
  saveDraftAction,
  sendDraftAction,
} from "@/app/actions/outreach";
import { Composer } from "@/components/client/Composer";
import { ConfirmButton } from "@/components/client/ConfirmButton";
import { buttonClass, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { EMAIL_STATUS_INFO, type EmailStatusValue } from "@/lib/email/validation";
import { parseList, parseObject } from "@/lib/json";
import { checkReadiness } from "@/lib/sending/send";
import { getActiveProfile } from "@/lib/session";
import { getDraft } from "@/lib/services/drafts";
import { NotFoundError } from "@/lib/services/errors";
import { listResumes } from "@/lib/services/resumes";
import { listTemplates } from "@/lib/services/templates";

export default async function DraftPage({ params }: PageProps<"/drafts/[id]">) {
  const { id } = await params;
  const profile = await getActiveProfile();
  let draft;
  try {
    draft = await getDraft(profile.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [readiness, resumes, templates, openings] = await Promise.all([
    checkReadiness(profile.id, id),
    listResumes(profile.id),
    listTemplates(profile.id),
    draft.contact.companyId ? db.jobOpportunity.findMany({ where: { companyId: draft.contact.companyId, status: "OPEN" }, select: { id: true, title: true } }) : [],
  ]);
  const info = EMAIL_STATUS_INFO[draft.contact.emailStatus as EmailStatusValue] ?? EMAIL_STATUS_INFO.NOT_CHECKED;
  const personalization = parseObject<{ used?: { label: string; value: string; sourceUrl?: string | null }[]; gaps?: string[]; blocking?: string[] }>(draft.personalization, {});

  return (
    <div className="space-y-4">
      <PageHeader
        title={draft.kind === "FOLLOW_UP" ? "Follow-up email" : "Review email"}
        description={`To ${draft.contact.fullName}${draft.contact.company ? ` at ${draft.contact.company.name}` : ""} · ${profile.portalName} portal · draft created ${draft.createdAt.toISOString().slice(0, 10)}`}
        actions={
          draft.sendState === "DRAFT" || draft.sendState === "FAILED" ? (
            <form action={cancelDraftAction}>
              <input type="hidden" name="id" value={draft.id} />
              <ConfirmButton title="Cancel this draft?" description="The draft is kept in history as cancelled and will not be sent." confirmLabel="Cancel draft" className={buttonClass.secondary}>Cancel draft</ConfirmButton>
            </form>
          ) : null
        }
      />
      <Composer
        draft={{
          id: draft.id,
          kind: draft.kind,
          subject: draft.subject,
          subjectAlternatives: parseList(draft.subjectAlternatives),
          body: draft.body,
          recipientEmail: draft.recipientEmail ?? "",
          recipientName: draft.recipientName,
          resumeId: draft.resumeId,
          opportunityId: draft.opportunityId,
          templateId: draft.templateId,
          contentHash: draft.contentHash,
          reviewedHash: draft.reviewedHash,
          sendState: draft.sendState,
          lastError: draft.lastError,
          guessAcknowledged: draft.guessAcknowledged,
          duplicateAcknowledged: draft.duplicateAcknowledged,
        }}
        candidateName={profile.candidateName}
        portalName={profile.portalName}
        contact={{
          id: draft.contact.id,
          fullName: draft.contact.fullName,
          title: draft.contact.title,
          company: draft.contact.company?.name ?? null,
          email: draft.contact.email,
          emailStatusLabel: info.label,
          emailStatusMeaning: info.meaning,
          emailStatusTone: info.tone,
          isGuess: draft.contact.emailOrigin === "PATTERN_GUESS",
        }}
        evidence={draft.contact.evidence.map((e) => ({ field: e.field, value: e.value, sourceUrl: e.sourceUrl, sourceType: e.sourceType, observedAt: e.observedAt.toISOString(), method: e.verificationMethod }))}
        personalization={{ used: personalization.used ?? [], gaps: personalization.gaps ?? [], blocking: personalization.blocking ?? [] }}
        resumes={resumes.map((r) => ({ id: r.id, label: r.label, originalFilename: r.originalFilename, sizeBytes: r.sizeBytes, isDefault: r.isDefault }))}
        openings={openings}
        templates={templates.map((t) => ({ id: t.id, name: t.name, recipientType: t.recipientType }))}
        initialReadiness={readiness}
        actions={{
          save: saveDraftAction as never,
          regenerate: regenerateDraftAction as never,
          review: markReviewedAction,
          acknowledge: acknowledgeAction,
          readiness: readinessAction as never,
          send: sendDraftAction as never,
          resolveUnknown: resolveUnknownAction,
        }}
      />
    </div>
  );
}
