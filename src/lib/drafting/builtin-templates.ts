/**
 * Built-in, editable outreach templates. Copies are stored per profile on first use;
 * users can edit them in Email Drafts → Templates. Wording deliberately avoids flattery,
 * unsupported claims and invented familiarity.
 */

export interface TemplateDef {
  name: string;
  recipientType: string;
  subjects: string[];
  body: string;
}

const SIGNOFF = `
{{phrases.signoff}}
{{candidate.name}}
{{#candidate.signature}}{{candidate.signature}}{{/candidate.signature}}`;

const INTRO = `I am {{candidate.name}}{{#candidate.status}}, {{candidate.status}}{{/candidate.status}}.`;

const COMPANY_HOOK = `{{#company.initiative}}I have been reading about {{company.initiative}}{{#company.initiativeSource}} ({{company.initiativeSource}}){{/company.initiativeSource}}, and {{phrases.interest}}.{{/company.initiative}}`;

const EXPERIENCE = `{{#experience.primary}}Through {{experience.primary}}, I developed {{#experience.capabilities}}skills in {{experience.capabilities}}{{/experience.capabilities}}{{^experience.capabilities}}relevant experience{{/experience.capabilities}}.{{#experience.outcome}} {{experience.outcome}}{{/experience.outcome}}{{/experience.primary}}{{^experience.primary}}{{#candidate.skills}}My background includes {{candidate.skills}}.{{/candidate.skills}}{{/experience.primary}}`;

export const BUILTIN_TEMPLATES: TemplateDef[] = [
  {
    name: "Recruiter – introduction",
    recipientType: "RECRUITER",
    subjects: [
      "{{function.title}} opportunities at {{company.name}} | {{candidate.name}}",
      "Interest in {{function.title}} roles at {{company.name}}",
      "{{candidate.name}} – {{function.title}} candidate for {{company.name}}",
    ],
    body: `{{greeting}}

${INTRO} {{phrases.reachingOut}} {{function.label}} opportunities at {{company.name}}{{#opportunity.title}}, including the {{opportunity.title}} role{{/opportunity.title}}.

${COMPANY_HOOK}

${EXPERIENCE}

I have attached my résumé for your consideration. {{phrases.ctaRecruiter}}

${SIGNOFF}`,
  },
  {
    name: "Functional leader – contribution",
    recipientType: "FUNCTIONAL_LEADER",
    subjects: [
      "Exploring a potential contribution to {{company.name}}'s {{function.label}} team",
      "Interested in your {{function.label}} team | {{candidate.name}}",
      "{{candidate.name}} – {{function.title}} at {{company.name}}",
    ],
    body: `{{greeting}}

${INTRO} I am reaching out because I am interested in contributing to {{company.name}}'s {{function.label}} work{{#recipient.title}}, which I understand falls within your remit as {{recipient.title}}{{/recipient.title}}.

${COMPANY_HOOK}{{#recipient.background}} I was also interested in your work on {{recipient.background}}.{{/recipient.background}}

${EXPERIENCE} I would welcome the chance to {{contribution}}.

I have attached my résumé. {{phrases.ctaLeader}}

${SIGNOFF}`,
  },
  {
    name: "Business head – concise",
    recipientType: "BUSINESS_HEAD",
    subjects: [
      "{{function.title}} at {{company.name}} – brief introduction",
      "Exploring opportunities at {{company.name}} | {{candidate.name}}",
    ],
    body: `{{greeting}}

${INTRO} I will keep this brief: I am interested in {{function.label}} opportunities at {{company.name}}.

${COMPANY_HOOK}

${EXPERIENCE}

If it is appropriate, I would be grateful if you could point me to the right person on your team. My résumé is attached.

${SIGNOFF}`,
  },
  {
    name: "Senior professional – advice",
    recipientType: "SENIOR",
    subjects: [
      "Seeking your perspective on {{function.label}} at {{company.name}}",
      "{{function.title}} at {{company.name}} | {{candidate.name}}",
    ],
    body: `{{greeting}}

${INTRO} {{phrases.reachingOut}} {{function.label}} at {{company.name}}, and your experience{{#recipient.title}} as {{recipient.title}}{{/recipient.title}} would be valuable to me.

${COMPANY_HOOK}

${EXPERIENCE}

{{phrases.ctaAdvice}} I have attached my résumé for context.

${SIGNOFF}`,
  },
  {
    name: "Junior professional – networking",
    recipientType: "JUNIOR",
    subjects: [
      "Question about {{function.label}} at {{company.name}}",
      "Learning about the {{function.label}} team at {{company.name}}",
    ],
    body: `{{greeting}}

${INTRO} I am exploring {{function.label}} roles and would value hearing about your experience at {{company.name}}{{#recipient.title}} as {{recipient.title}}{{/recipient.title}}.

${COMPANY_HOOK}

${EXPERIENCE}

Would you be open to a short call? Any perspective on how the team works or hires would be very helpful. My résumé is attached for context.

${SIGNOFF}`,
  },
  {
    name: "Open role – application",
    recipientType: "OPEN_ROLE",
    subjects: [
      "Application: {{opportunity.title}} | {{candidate.name}}",
      "{{opportunity.title}} at {{company.name}} – {{candidate.name}}",
    ],
    body: `{{greeting}}

${INTRO} I am writing regarding the {{opportunity.title}} role at {{company.name}}{{#opportunity.url}} ({{opportunity.url}}){{/opportunity.url}}.

${EXPERIENCE}

${COMPANY_HOOK}

I have attached my résumé. {{phrases.ctaRecruiter}}

${SIGNOFF}`,
  },
  {
    name: "General networking",
    recipientType: "NETWORKING",
    subjects: [
      "Exploring {{function.label}} at {{company.name}} | {{candidate.name}}",
      "Introduction – {{candidate.name}}",
    ],
    body: `{{greeting}}

${INTRO} {{phrases.reachingOut}} {{function.label}} opportunities at {{company.name}}.

${COMPANY_HOOK}

${EXPERIENCE}

If my background seems relevant, I would appreciate a brief conversation or guidance on suitable opportunities. My résumé is attached.

${SIGNOFF}`,
  },
  {
    name: "Follow-up – polite",
    recipientType: "FOLLOW_UP",
    subjects: ["Re: {{previous.subject}}", "Following up – {{candidate.name}}"],
    body: `{{greeting}}

I am following up on my email{{#previous.date}} from {{previous.date}}{{/previous.date}} about {{function.label}} opportunities at {{company.name}}. I understand you are busy, so I will keep this short.

If there is someone else on the team I should speak with, I would be grateful for a pointer. {{#attachResume}}I have attached my résumé again for convenience.{{/attachResume}}

Thank you for your time.

${SIGNOFF}`,
  },
];

export const PHRASES = {
  reachingOut: [
    "I am reaching out to explore",
    "I am writing to ask about",
    "I would like to learn more about",
  ],
  interest: [
    "it is the kind of work I would like to contribute to",
    "it connects closely with the work I want to do",
    "it is a large part of why I am interested in the company",
  ],
  ctaRecruiter: [
    "If my background is a fit for current or upcoming roles, I would appreciate a brief conversation.",
    "I would be grateful to know whether there is a suitable role I could be considered for.",
    "If helpful, I am happy to share anything else you need for your assessment.",
  ],
  ctaLeader: [
    "If my background seems relevant to your team, would you be open to a brief 15-minute conversation?",
    "I would value a short conversation, or guidance on who would be best to speak with.",
  ],
  ctaAdvice: [
    "Would you be open to a 15-minute conversation in the coming weeks?",
    "If you have time, I would value a short call to hear your perspective.",
  ],
  signoff: ["Kind regards,", "Best regards,", "Regards,"],
};
