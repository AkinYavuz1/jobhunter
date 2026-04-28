export type EmploymentType = 'permanent' | 'contract' | 'fixed-term' | 'unknown';
export type JobSource = 'adzuna' | 'reed' | 'totaljobs' | 'cwjobs' | 'indeed';

export interface RawJob {
  id: string;            // source:external_id
  source: JobSource;
  title: string;
  company: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: string;  // annual | day | hour
  employmentType: EmploymentType;
  description: string | null;
  descriptionFull: boolean;
  url: string;
  urlCanonical: string;
  postedAt: Date | null;
  raw: unknown;
}

export interface ScoredJob extends RawJob {
  obtainability: number;
  obtainabilityReason: string;
}

export interface GeneratedDocs {
  coverLetter: string;
  cvTailored: TailoredCV;
  folderPath: string;
  pageCount: number;
}

export interface TailoredCV {
  profile: string;
  skills: string[];
  employment: TailoredRole[];
  certifications: string[];
  location: string;
  keyProjects?: { name: string; description: string }[];
}

export interface TailoredRole {
  title: string;
  company: string;
  period: string;
  bullets: string[];
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  jobsCollected: number;
  jobsAfterFilter: number;
  jobsNew: number;
  docsGenerated: number;
  notificationsSent: number;
  errors: string[];
}
