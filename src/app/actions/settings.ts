"use server";

import { redirect } from "next/navigation";
import { formObject, run, str, type ActionState } from "@/lib/action-utils";
import type { ColumnMapping } from "@/lib/csv/csv";
import { activeProfileId, requireAccess } from "@/lib/session";
import { deleteAccount, saveAccount, setActiveAccount, testAccount } from "@/lib/sending/accounts";
import { previewImport, runImport, type MergeMode } from "@/lib/services/csv-import";
import { applyRetention, backupDatabase, deleteProfileData } from "@/lib/services/data";
import { UserError } from "@/lib/services/errors";
import { updateSettings } from "@/lib/services/settings";

export async function saveAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => saveAccount(await activeProfileId(), formObject(fd) as never, str(fd, "id") || undefined), "Sender account saved. No credentials were stored in the database.");
}

export async function testAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => testAccount(await activeProfileId(), str(fd, "id")), (r) => r);
}

export async function activateAccountAction(fd: FormData) {
  await setActiveAccount(await activeProfileId(), str(fd, "id"));
  redirect("/settings#sender");
}

export async function deleteAccountAction(fd: FormData) {
  await deleteAccount(await activeProfileId(), str(fd, "id"));
  redirect("/settings#sender");
}

export async function saveAppSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requireAccess();
    await updateSettings(formObject(fd) as never);
  }, "Settings saved.");
}

export async function retentionAction(): Promise<ActionState> {
  return run(async () => {
    await requireAccess();
    return applyRetention();
  }, (r) => `Deleted ${r.searchHistoryDeleted} old search record(s) and ${r.documentsDeleted} unreferenced page(s).`);
}

export async function backupAction(): Promise<ActionState> {
  return run(async () => {
    await requireAccess();
    return backupDatabase();
  }, (p) => `Backup written to ${p}`);
}

export async function deleteProfileDataAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await run(async () => {
    const id = await activeProfileId();
    if (str(fd, "confirm") !== "DELETE") throw new UserError('Type DELETE to confirm.');
    await deleteProfileData(id, { deleteProfile: false });
  });
  if (res.ok) redirect("/");
  return res;
}

export async function previewImportAction(text: string, mapping?: ColumnMapping) {
  return run(async () => previewImport(await activeProfileId(), text, mapping));
}

export async function runImportAction(text: string, mapping: ColumnMapping, mode: MergeMode) {
  return run(async () => runImport(await activeProfileId(), text, mapping, mode), (r) => `Imported ${r.created}, merged ${r.merged}, skipped ${r.skipped}.`);
}
