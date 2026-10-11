/** Outreach CRM stages. */
export const STAGES = [
  "NEW",
  "RESEARCH_NEEDED",
  "READY_TO_CONTACT",
  "DRAFT_PREPARED",
  "SENT",
  "FOLLOW_UP_DUE",
  "REPLIED",
  "MEETING_SCHEDULED",
  "OPPORTUNITY_IDENTIFIED",
  "REFERRED",
  "APPLIED",
  "REJECTED",
  "NOT_RELEVANT",
  "DO_NOT_CONTACT",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  NEW: "New",
  RESEARCH_NEEDED: "Research needed",
  READY_TO_CONTACT: "Ready to contact",
  DRAFT_PREPARED: "Draft prepared",
  SENT: "Sent",
  FOLLOW_UP_DUE: "Follow-up due",
  REPLIED: "Replied",
  MEETING_SCHEDULED: "Meeting scheduled",
  OPPORTUNITY_IDENTIFIED: "Opportunity identified",
  REFERRED: "Referred",
  APPLIED: "Applied",
  REJECTED: "Rejected",
  NOT_RELEVANT: "Not relevant",
  DO_NOT_CONTACT: "Do not contact",
};
