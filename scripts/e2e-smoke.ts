/**
 * End-to-end smoke test of the real UI (npm run test:e2e). Requires `npm run build` first.
 *
 * - Uses a temporary database and data directory (your real data is never touched).
 * - Uses a LOCAL SMTP sink on 127.0.0.1 – no email ever leaves the machine.
 * - Drives Chromium through: profile set-up → résumé upload → company → research →
 *   contact → draft → final preview → one-click send → isolation checks.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { chromium, type Page } from "playwright";
import { makePdf } from "../tests/helpers/fixtures";

const PORT = 3210;
const SMTP_PORT = 2525;
const BASE = `http://127.0.0.1:${PORT}`;
const shotsDir = process.env.E2E_SCREENSHOTS ?? path.join(os.tmpdir(), "careerreach-e2e-shots");

function log(msg: string) {
  console.log(`[e2e] ${msg}`);
}

async function waitFor(url: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "careerreach-e2e-"));
  const env = {
    ...process.env,
    DATABASE_URL: `file:${path.join(tmp, "e2e.db")}`,
    CAREERREACH_DATA_DIR: tmp,
    CAREERREACH_E2E_SMTP_PASS: "local-test-only",
    // The local SMTP sink uses a self-signed STARTTLS certificate.
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete (env as Record<string, string | undefined>).CAREERREACH_ACCESS_PASSWORD;
  delete (env as Record<string, string | undefined>).HTTPS_PROXY;
  delete (env as Record<string, string | undefined>).https_proxy;
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "ignore" });
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { env, stdio: "ignore" });
  log(`temporary data in ${tmp}`);

  const received: { to: string[]; raw: string }[] = [];
  const smtp = new SMTPServer({
    authOptional: true,
    onAuth: (_auth, _session, cb) => cb(null, { user: "e2e" }),
    onData(stream, session, cb) {
      let raw = "";
      stream.on("data", (c) => (raw += c.toString()));
      stream.on("end", () => {
        received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(SMTP_PORT, "127.0.0.1", r));

  const server: ChildProcess = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let serverLog = "";
  server.stdout?.on("data", (d) => (serverLog += d));
  server.stderr?.on("data", (d) => (serverLog += d));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined) });
  let failed = false;
  let page: Page | null = null;
  try {
    await waitFor(BASE);
    page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    page.on("pageerror", (e) => log(`browser error: ${e.message}`));

    // 1. Dashboard
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Marketing dashboard" }).waitFor();
    await shot(page, "01-dashboard-empty");
    log("dashboard renders");

    // 2. Profile + sender
    await page.goto(`${BASE}/settings`);
    await page.getByLabel("Candidate name (as on the résumé)").fill("Test Candidate");
    await page.getByLabel("Current status (verified)").fill("an MBA candidate (E2E fixture)");
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.getByText("Profile saved.").waitFor();
    await page.getByLabel("From address").fill("e2e.sender@example.org");
    await page.getByLabel("SMTP host").fill("127.0.0.1");
    await page.getByLabel("SMTP port").fill(String(SMTP_PORT));
    await page.getByLabel("Implicit TLS (port 465)").uncheck();
    await page.getByLabel("SMTP username").fill("e2e");
    await page.getByLabel("Env variable holding the app password").fill("CAREERREACH_E2E_SMTP_PASS");
    await page.getByRole("button", { name: "Save account" }).click();
    await page.getByText("Sender account saved").waitFor();
    await page.reload();
    await page.getByText("Ready to send").waitFor();
    await shot(page, "02-settings");
    log("profile and sender configured (password only in env)");

    // 3. Résumé + highlight
    await page.goto(`${BASE}/resumes`);
    await page.getByLabel("PDF file").setInputFiles({ name: "Test_Candidate_Resume.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf("Test Candidate - Marketing Intern at Snackco")) });
    await page.getByLabel("Version label").fill("Marketing");
    await page.getByRole("button", { name: "Upload" }).click();
    await page.getByText("Uploaded Test_Candidate_Resume.pdf.").waitFor();
    await page.getByText("Add a highlight").click();
    await page.getByLabel("Title / role").last().fill("Marketing Intern");
    await page.getByLabel("Organisation").last().fill("Snackco");
    await page.getByLabel("Capabilities").last().fill("consumer research, campaign analysis");
    await page.getByLabel("I confirm this matches the résumé").last().check();
    await page.getByRole("button", { name: "Add highlight" }).click();
    await page.getByText("Saved.").waitFor();
    await page.reload();
    await page.getByText("Confirmed – used in emails").waitFor();
    await shot(page, "03-resumes");
    log("résumé uploaded and highlight confirmed");

    // 4. Company + confirmed research
    await page.goto(`${BASE}/discover/companies`);
    await page.getByLabel("Company name", { exact: true }).fill("Example Foods");
    await page.getByLabel("Official website", { exact: true }).fill("https://examplefoods.test");
    await page.getByLabel("Industry", { exact: true }).last().fill("FMCG");
    await page.getByRole("button", { name: "Add company" }).click();
    await page.waitForURL(/\/companies\/.+/);
    const companyUrl = page.url();
    await page.locator("#r-u").fill("https://examplefoods.test/news/millet");
    await page.getByLabel("Statement (used in emails)").fill("the launch of its millet snack range");
    await page.getByLabel("I checked the source; allow use in emails").check();
    await page.getByRole("button", { name: "Save research" }).click();
    await page.getByText("Research saved.").waitFor();
    await shot(page, "04-company");
    log("company added with confirmed, sourced research");

    // 5. Manual contact
    const companyId = companyUrl.split("/").pop();
    await page.goto(`${BASE}/discover/contacts?companyId=${companyId}`);
    await page.getByLabel("Full name *").fill("Priya Example");
    await page.getByLabel("Current title").fill("Head of Marketing");
    await page.getByLabel("Professional email").fill("priya@examplefoods.test");
    await page.locator("#cf-src").fill("https://examplefoods.test/team");
    await page.locator("#cf-stype").selectOption("OFFICIAL_TEAM_PAGE");
    await page.getByRole("button", { name: "Add contact" }).click();
    await page.waitForURL(/\/contacts\/.+/);
    const contactUrl = page.url();
    await page.getByText("Field-level evidence").waitFor();
    await shot(page, "05-contact");
    log("contact created with manual evidence");

    // 6. Prepare → review → send
    await page.getByRole("button", { name: "Prepare email" }).click();
    await page.waitForURL(/\/drafts\/.+/);
    const draftUrl = page.url();
    const body = await page.locator("#body").inputValue();
    if (!body.includes("Test Candidate") || !body.includes("millet snack range") || !body.includes("Marketing Intern at Snackco")) {
      throw new Error(`Draft is missing verified facts:\n${body}`);
    }
    await page.getByText("Will attach").waitFor();
    await shot(page, "06-composer");
    if (received.length) throw new Error("An email was sent before approval!");
    await page.getByRole("button", { name: "Review & send…" }).click();
    await page.getByRole("dialog").getByText("Final preview").waitFor();
    await shot(page, "07-final-preview");
    const send = page.getByRole("button", { name: "Send email" });
    await send.click();
    await page.getByText("Sent – accepted by the mail server").waitFor({ timeout: 30_000 });
    await shot(page, "08-sent");
    if (received.length !== 1) throw new Error(`Expected exactly 1 message at the SMTP sink, got ${received.length}`);
    const msg = received[0];
    if (!msg.to.includes("priya@examplefoods.test")) throw new Error("Wrong recipient");
    if (!/filename="?Test_Candidate_Resume\.pdf/.test(msg.raw)) throw new Error("Résumé attachment missing");
    log("exactly one email delivered to the local SMTP sink, with the correct résumé attached");

    // 7. No resend possible
    await page.goto(draftUrl);
    await page.getByText("This email was accepted by the mail server").waitFor();
    if (await page.getByRole("button", { name: "Review & send…" }).count()) throw new Error("Send still available after sending");
    await page.goto(contactUrl);
    await page.getByText("accepted by server").waitFor();
    log("sent draft is locked; contact shows provider-confirmed send");

    // 8. Profile isolation
    await page.goto(BASE);
    await page.getByLabel("Candidate portal").selectOption({ label: "Finance — (name not set)" });
    await page.getByRole("heading", { name: "Finance dashboard" }).waitFor();
    await page.goto(`${BASE}/contacts`);
    if (await page.getByText("Priya Example").count()) throw new Error("Marketing contact visible in Finance portal");
    await page.goto(contactUrl);
    await page.getByRole("heading", { name: "Not found" }).waitFor();
    await page.goto(`${BASE}/drafts`);
    await page.getByText("Draft-only mode").waitFor();
    log("Finance portal cannot see Marketing contacts or drafts; it is in draft-only mode");

    // 9. Pages render
    for (const p of ["/pipeline", "/followups", "/import-export", "/companies", "/drafts/templates", "/discover/companies"]) {
      const r = await page.goto(`${BASE}${p}`);
      if (!r || r.status() >= 400) throw new Error(`${p} returned ${r?.status()}`);
    }
    await page.getByLabel("Candidate portal").selectOption({ index: 0 });
    await page.goto(`${BASE}/pipeline`);
    await shot(page, "09-pipeline");
    await page.goto(`${BASE}/followups`);
    await shot(page, "10-followups");
    await page.goto(BASE);
    await shot(page, "11-dashboard");
    log("all pages render");
    log(`PASSED · screenshots in ${shotsDir}`);
  } catch (e) {
    failed = true;
    console.error("[e2e] FAILED:", e);
    if (page) await shot(page, "zz-failure").catch(() => undefined);
    console.error(serverLog.slice(-4000));
  } finally {
    await browser.close();
    try {
      process.kill(-server.pid!, "SIGTERM"); // whole process group (npx → next-server)
    } catch {
      server.kill("SIGTERM");
    }
    smtp.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
