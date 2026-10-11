"use server";

import { redirect } from "next/navigation";
import { formObject, run, str, bool, type ActionState } from "@/lib/action-utils";
import { activeProfileId } from "@/lib/session";
import {
  addEvidence,
  changeStage,
  confirmCurrentRole,
  createContact,
  deleteContact,
  deleteEvidence,
  mergeContacts,
  recomputeAllForProfile,
  setReviewState,
  updateContact,
  type Stage,
} from "@/lib/services/contacts";
import { applyEmailGuess, emailGuesses, recheckEmailOnPage, runEmailChecks } from "@/lib/services/verification";

export async function createContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null;
  const res = await run(async () => {
    const c = await createContact(await activeProfileId(), formObject(fd) as never, { allowDuplicate: bool(fd, "allowDuplicate") });
    id = c.id;
  });
  if (res.ok && id) redirect(`/contacts/${id}`);
  return res;
}

export async function updateContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => updateContact(await activeProfileId(), str(fd, "id"), formObject(fd) as never), "Contact saved. Changed values were recorded as manual evidence.");
}

export async function deleteContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await run(async () => deleteContact(await activeProfileId(), str(fd, "id")));
  if (res.ok) redirect("/contacts");
  return res;
}

export async function changeStageAction(fd: FormData) {
  await changeStage(await activeProfileId(), str(fd, "id"), str(fd, "stage") as Stage, { note: str(fd, "note") || null });
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/", "layout");
}

export async function changeStageStateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => changeStage(await activeProfileId(), str(fd, "id"), str(fd, "stage") as Stage, { note: str(fd, "note") || null }), "Stage updated.");
}

export async function setReviewAction(fd: FormData) {
  await setReviewState(await activeProfileId(), str(fd, "id"), str(fd, "state") as never);
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/", "layout");
}

export async function confirmRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => confirmCurrentRole(await activeProfileId(), str(fd, "id"), str(fd, "note") || null), "Role recorded as confirmed by you today.");
}

export async function addEvidenceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    async () =>
      addEvidence(await activeProfileId(), str(fd, "id"), {
        field: str(fd, "field"),
        value: str(fd, "value"),
        sourceUrl: str(fd, "sourceUrl") || null,
        sourceType: str(fd, "sourceType"),
        publishedAt: str(fd, "publishedAt") || null,
        notes: str(fd, "notes") || null,
        snippet: str(fd, "snippet") || null,
      }),
    "Evidence added.",
  );
}

export async function deleteEvidenceAction(fd: FormData) {
  await deleteEvidence(await activeProfileId(), str(fd, "evidenceId"));
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/", "layout");
}

export async function mergeContactsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => mergeContacts(await activeProfileId(), str(fd, "primaryId"), str(fd, "secondaryId")), "Contacts merged; evidence and history preserved.");
}

export async function runChecksAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    async () => runEmailChecks(await activeProfileId(), str(fd, "id"), { provider: bool(fd, "provider"), smtp: bool(fd, "smtp") }),
    (r) => r.map((x) => `${x.stage.replace(/_/g, " ").toLowerCase()}: ${x.result.toLowerCase()}`).join(" · "),
  );
}

export async function recheckSourceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    async () => recheckEmailOnPage(await activeProfileId(), str(fd, "id"), str(fd, "url")),
    (r) => (r.found ? `Exact address found at ${r.url}. Recorded as public evidence.` : `The exact address was not found at ${r.url}.`),
  );
}

export async function emailGuessesAction(_: ActionState<Awaited<ReturnType<typeof emailGuesses>>>, fd: FormData) {
  return run(async () => emailGuesses(await activeProfileId(), str(fd, "id")));
}

export async function applyGuessAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => applyEmailGuess(await activeProfileId(), str(fd, "id"), str(fd, "email")), "Guessed address saved as UNCERTAIN. It must be acknowledged before sending.");
}

export async function recomputeAllAction(): Promise<ActionState> {
  return run(async () => recomputeAllForProfile(await activeProfileId()), (n) => `Recalculated ${n} contact(s).`);
}
