-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "portalName" TEXT NOT NULL,
    "candidateName" TEXT,
    "currentStatus" TEXT,
    "education" TEXT,
    "careerObjective" TEXT,
    "signature" TEXT,
    "skills" TEXT NOT NULL DEFAULT '[]',
    "targetRoles" TEXT NOT NULL DEFAULT '[]',
    "targetIndustries" TEXT NOT NULL DEFAULT '[]',
    "targetFunctions" TEXT NOT NULL DEFAULT '[]',
    "targetContactTitles" TEXT NOT NULL DEFAULT '[]',
    "preferredLocations" TEXT NOT NULL DEFAULT '[]',
    "dailySendLimit" INTEGER NOT NULL DEFAULT 15,
    "followUpAfterDays" INTEGER NOT NULL DEFAULT 7,
    "maxFollowUps" INTEGER NOT NULL DEFAULT 1,
    "failedSendCooldownMinutes" INTEGER NOT NULL DEFAULT 30,
    "accentColor" TEXT NOT NULL DEFAULT 'indigo',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProfileHighlight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "organization" TEXT,
    "summary" TEXT,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProfileHighlight_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storedFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "extractedText" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Resume_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "domain" TEXT,
    "website" TEXT,
    "careersUrl" TEXT,
    "leadershipUrl" TEXT,
    "industry" TEXT,
    "headquarters" TEXT,
    "sizeRange" TEXT,
    "businessModel" TEXT,
    "description" TEXT,
    "descriptionSourceUrl" TEXT,
    "wikidataId" TEXT,
    "atsProvider" TEXT,
    "atsSlug" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceUrls" TEXT NOT NULL DEFAULT '[]',
    "lastResearchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProfileCompany" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TARGET',
    "targetType" TEXT NOT NULL DEFAULT 'SPECULATIVE',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProfileCompany_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProfileCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompanyChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "phoneType" TEXT,
    "sourceUrl" TEXT,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyChannel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "httpStatus" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "textExcerpt" TEXT,
    "publishedAt" DATETIME,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,
    CONSTRAINT "SourceDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobOpportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "location" TEXT,
    "url" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "descriptionExcerpt" TEXT,
    "postedAt" DATETIME,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobOpportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT,
    "contactId" TEXT,
    "kind" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "quote" TEXT,
    "sourceUrl" TEXT,
    "sourceDocumentId" TEXT,
    "publishedAt" DATETIME,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchItem_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "companyId" TEXT,
    "fullName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "title" TEXT,
    "department" TEXT,
    "seniority" TEXT,
    "location" TEXT,
    "profileUrl" TEXT,
    "bioUrl" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "emailOrigin" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
    "emailCheckedAt" DATETIME,
    "phone" TEXT,
    "phoneType" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "reviewState" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "reviewReasons" TEXT NOT NULL DEFAULT '[]',
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "relevanceScore" INTEGER,
    "relevanceBreakdown" TEXT,
    "roleConfirmedAt" DATETIME,
    "emailLastObservedAt" DATETIME,
    "phoneLastObservedAt" DATETIME,
    "lastObservedAt" DATETIME,
    "notes" TEXT,
    "mergedIntoId" TEXT,
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contact_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactFieldEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "verificationMethod" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "snippet" TEXT,
    "notes" TEXT,
    "origin" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactFieldEvidence_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactFieldEvidence_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "provider" TEXT,
    "details" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerification_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedSearch_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SearchHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "params" TEXT,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutreachTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "subjectTemplates" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutreachTemplate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT,
    "secretEnvVar" TEXT,
    "imapEnabled" BOOLEAN NOT NULL DEFAULT false,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "providerDailyLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTestAt" DATETIME,
    "lastTestResult" TEXT,
    "lastReplySyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT,
    "opportunityId" TEXT,
    "resumeId" TEXT,
    "templateId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'INITIAL',
    "recipientType" TEXT,
    "recipientEmail" TEXT,
    "recipientName" TEXT,
    "subject" TEXT NOT NULL,
    "subjectAlternatives" TEXT NOT NULL DEFAULT '[]',
    "body" TEXT NOT NULL,
    "personalization" TEXT NOT NULL DEFAULT '{}',
    "contentHash" TEXT NOT NULL,
    "reviewedHash" TEXT,
    "reviewedAt" DATETIME,
    "guessAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "duplicateAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "sendState" TEXT NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT NOT NULL,
    "inReplyToMessageId" TEXT,
    "sentAt" DATETIME,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailDraft_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailDraft_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "JobOpportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailDraft_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailDraft_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OutreachTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutreachActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "fromStage" TEXT,
    "toStage" TEXT,
    "draftId" TEXT,
    "sendLogId" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutreachActivity_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailSendLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "emailAccountId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodySnapshot" TEXT NOT NULL,
    "attachmentResumeId" TEXT,
    "attachmentFilename" TEXT,
    "attachmentSha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "providerResponse" TEXT,
    "errorMessage" TEXT,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "bounceSource" TEXT,
    "bouncedAt" DATETIME,
    "bounceDetails" TEXT,
    "replySource" TEXT,
    "repliedAt" DATETIME,
    "replySnippet" TEXT,
    CONSTRAINT "EmailSendLog_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailSendLog_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "EmailDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailSendLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailSendLog_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailSendLog_attachmentResumeId_fkey" FOREIGN KEY ("attachmentResumeId") REFERENCES "Resume" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "previousSendId" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "suppressedReason" TEXT,
    "draftId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FollowUp_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUp_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUp_previousSendId_fkey" FOREIGN KEY ("previousSendId") REFERENCES "EmailSendLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FollowUp_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "EmailDraft" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SuppressionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT,
    "email" TEXT,
    "domain" TEXT,
    "contactId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuppressionRecord_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApplicationSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "userAgentContact" TEXT,
    "requestDelayMs" INTEGER NOT NULL DEFAULT 1500,
    "maxPagesPerSite" INTEGER NOT NULL DEFAULT 8,
    "fetchTimeoutMs" INTEGER NOT NULL DEFAULT 12000,
    "maxResponseBytes" INTEGER NOT NULL DEFAULT 2000000,
    "searchHistoryRetentionDays" INTEGER NOT NULL DEFAULT 180,
    "sourceDocumentRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "smtpDiagnosticsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "wikidataEnabled" BOOLEAN NOT NULL DEFAULT true,
    "jobBoardsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "websiteResearchEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_slug_key" ON "CandidateProfile"("slug");

-- CreateIndex
CREATE INDEX "ProfileHighlight_profileId_idx" ON "ProfileHighlight"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "Resume_storedFilename_key" ON "Resume"("storedFilename");

-- CreateIndex
CREATE INDEX "Resume_profileId_idx" ON "Resume"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Company_wikidataId_key" ON "Company"("wikidataId");

-- CreateIndex
CREATE INDEX "Company_normalizedName_idx" ON "Company"("normalizedName");

-- CreateIndex
CREATE INDEX "ProfileCompany_companyId_idx" ON "ProfileCompany"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileCompany_profileId_companyId_key" ON "ProfileCompany"("profileId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyChannel_companyId_kind_value_key" ON "CompanyChannel"("companyId", "kind", "value");

-- CreateIndex
CREATE INDEX "SourceDocument_finalUrl_idx" ON "SourceDocument"("finalUrl");

-- CreateIndex
CREATE INDEX "SourceDocument_companyId_idx" ON "SourceDocument"("companyId");

-- CreateIndex
CREATE INDEX "JobOpportunity_companyId_idx" ON "JobOpportunity"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOpportunity_source_externalId_key" ON "JobOpportunity"("source", "externalId");

-- CreateIndex
CREATE INDEX "ResearchItem_companyId_idx" ON "ResearchItem"("companyId");

-- CreateIndex
CREATE INDEX "ResearchItem_contactId_idx" ON "ResearchItem"("contactId");

-- CreateIndex
CREATE INDEX "Contact_profileId_stage_idx" ON "Contact"("profileId", "stage");

-- CreateIndex
CREATE INDEX "Contact_profileId_emailNormalized_idx" ON "Contact"("profileId", "emailNormalized");

-- CreateIndex
CREATE INDEX "Contact_profileId_normalizedName_idx" ON "Contact"("profileId", "normalizedName");

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");

-- CreateIndex
CREATE INDEX "ContactFieldEvidence_contactId_field_idx" ON "ContactFieldEvidence"("contactId", "field");

-- CreateIndex
CREATE INDEX "EmailVerification_contactId_email_idx" ON "EmailVerification"("contactId", "email");

-- CreateIndex
CREATE INDEX "SavedSearch_profileId_idx" ON "SavedSearch"("profileId");

-- CreateIndex
CREATE INDEX "SearchHistory_profileId_createdAt_idx" ON "SearchHistory"("profileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachTemplate_profileId_name_key" ON "OutreachTemplate"("profileId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_profileId_fromAddress_key" ON "EmailAccount"("profileId", "fromAddress");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDraft_idempotencyKey_key" ON "EmailDraft"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailDraft_profileId_sendState_idx" ON "EmailDraft"("profileId", "sendState");

-- CreateIndex
CREATE INDEX "EmailDraft_contactId_idx" ON "EmailDraft"("contactId");

-- CreateIndex
CREATE INDEX "OutreachActivity_profileId_occurredAt_idx" ON "OutreachActivity"("profileId", "occurredAt");

-- CreateIndex
CREATE INDEX "OutreachActivity_contactId_idx" ON "OutreachActivity"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSendLog_idempotencyKey_key" ON "EmailSendLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailSendLog_profileId_attemptedAt_idx" ON "EmailSendLog"("profileId", "attemptedAt");

-- CreateIndex
CREATE INDEX "EmailSendLog_contactId_idx" ON "EmailSendLog"("contactId");

-- CreateIndex
CREATE INDEX "EmailSendLog_toAddress_idx" ON "EmailSendLog"("toAddress");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_draftId_key" ON "FollowUp"("draftId");

-- CreateIndex
CREATE INDEX "FollowUp_profileId_status_dueDate_idx" ON "FollowUp"("profileId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "SuppressionRecord_email_idx" ON "SuppressionRecord"("email");

-- CreateIndex
CREATE INDEX "SuppressionRecord_domain_idx" ON "SuppressionRecord"("domain");
