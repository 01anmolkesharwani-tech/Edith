"use server";

import { revalidatePath } from "next/cache";
import { bool, run, str, type ActionState } from "@/lib/action-utils";
import { activeProfileId } from "@/lib/session";
import { saveHighlight } from "@/lib/services/profiles";
import { deleteResume, renameResume, saveResume, setDefaultResume } from "@/lib/services/resumes";
import { UserError } from "@/lib/services/errors";

export async function uploadResumeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = await activeProfileId();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a PDF file to upload.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await saveResume(id, { name: file.name, bytes }, str(fd, "label"), bool(fd, "makeDefault"));
    return r.originalFilename;
  }, (name) => `Uploaded ${name}.`);
}

export async function setDefaultResumeAction(fd: FormData) {
  await setDefaultResume(await activeProfileId(), str(fd, "id"));
  revalidatePath("/", "layout");
}

export async function renameResumeAction(fd: FormData) {
  await renameResume(await activeProfileId(), str(fd, "id"), str(fd, "label"));
  revalidatePath("/resumes");
}

export async function deleteResumeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => deleteResume(await activeProfileId(), str(fd, "id")), "Résumé deleted.");
}

/** Add a suggestion extracted from the résumé as an UNCONFIRMED highlight for the user to edit and confirm. */
export async function addSuggestedHighlightAction(fd: FormData) {
  const id = await activeProfileId();
  await saveHighlight(id, { kind: str(fd, "kind") as never, title: str(fd, "title").slice(0, 200), summary: str(fd, "summary").slice(0, 1000), confirmed: false }, undefined, `resume:${str(fd, "resumeId")}`);
  revalidatePath("/resumes");
}
