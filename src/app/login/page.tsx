import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/profile";
import { ActionForm } from "@/components/client/ActionForm";
import { inputClass } from "@/components/ui";

export default function LoginPage() {
  if (!process.env.CAREERREACH_ACCESS_PASSWORD) redirect("/");
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">CareerReach</h1>
      <p className="mb-4 mt-1 text-sm text-slate-600">Enter the access password configured for this installation.</p>
      <ActionForm action={loginAction} submitLabel="Unlock">
        <label htmlFor="password" className="sr-only">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </ActionForm>
    </div>
  );
}
