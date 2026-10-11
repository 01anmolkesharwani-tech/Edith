import { EMAIL_STATUS_INFO, type EmailStatusValue } from "@/lib/email/validation";
import { FRESHNESS_LABELS, type FreshnessCategory } from "@/lib/domain/freshness";
import { STAGE_LABELS, type Stage } from "@/lib/domain/stages";
import { Badge } from "./ui";

export function EmailStatusBadge({ status, origin }: { status: string; origin?: string | null }) {
  const info = EMAIL_STATUS_INFO[status as EmailStatusValue] ?? EMAIL_STATUS_INFO.NOT_CHECKED;
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={info.tone} title={info.meaning}>
        {info.label}
      </Badge>
      {origin === "PATTERN_GUESS" ? (
        <Badge tone="amber" title="Inferred from a naming pattern; never verified by itself">
          Guessed
        </Badge>
      ) : null}
    </span>
  );
}

const FRESH_TONES: Record<FreshnessCategory, string> = { FRESH: "green", RECENT: "blue", AGING: "amber", STALE: "red", UNKNOWN: "gray" };

export function FreshnessBadge({ value }: { value: FreshnessCategory }) {
  return (
    <Badge tone={FRESH_TONES[value]} title="Heuristic based on dated evidence; not a guarantee">
      {FRESHNESS_LABELS[value]}
    </Badge>
  );
}

const STAGE_TONES: Partial<Record<Stage, string>> = {
  NEW: "gray",
  RESEARCH_NEEDED: "amber",
  READY_TO_CONTACT: "blue",
  DRAFT_PREPARED: "indigo",
  SENT: "indigo",
  FOLLOW_UP_DUE: "amber",
  REPLIED: "green",
  MEETING_SCHEDULED: "green",
  OPPORTUNITY_IDENTIFIED: "green",
  REFERRED: "green",
  APPLIED: "purple",
  REJECTED: "red",
  NOT_RELEVANT: "gray",
  DO_NOT_CONTACT: "red",
};

export function StageBadge({ stage }: { stage: string }) {
  return <Badge tone={STAGE_TONES[stage as Stage] ?? "gray"}>{STAGE_LABELS[stage as Stage] ?? stage}</Badge>;
}

export function OriginBadge({ origin }: { origin: string }) {
  if (origin === "AUTOMATED") return <Badge tone="purple" title="Found automatically from a public source">Automated</Badge>;
  if (origin === "IMPORTED") return <Badge tone="blue" title="Imported from CSV – not verified">Imported</Badge>;
  return <Badge tone="gray" title="Entered or confirmed manually">Manual</Badge>;
}

export function ReviewBadge({ state }: { state: string }) {
  if (state === "CONFIRMED") return <Badge tone="green">Reviewed</Badge>;
  if (state === "NEEDS_REVIEW") return <Badge tone="red">Needs review</Badge>;
  return <Badge tone="amber">Unreviewed</Badge>;
}

export function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <Badge>—</Badge>;
  const tone = score >= 75 ? "green" : score >= 55 ? "blue" : score >= 35 ? "amber" : "gray";
  return <Badge tone={tone} title="Explainable relevance score (0–100); open the contact for the breakdown">{score}</Badge>;
}

export function SourceTypeLabel({ type }: { type: string }) {
  return <span className="text-xs text-slate-600">{type.replace(/_/g, " ").toLowerCase()}</span>;
}
