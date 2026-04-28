import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai';
import { env } from './env.js';
import type { RawJob, ScoredJob, TailoredCV } from './types.js';

const genai = new GoogleGenerativeAI(env.GEMINI_API_KEY);

const responseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    obtainability: { type: SchemaType.INTEGER, description: '0-100 obtainability score' },
    obtainabilityReason: { type: SchemaType.STRING, description: '1-2 sentence reason for score' },
    coverLetter: { type: SchemaType.STRING, description: '1-paragraph cover letter ~100 words' },
    cv: {
      type: SchemaType.OBJECT,
      properties: {
        profile: { type: SchemaType.STRING },
        skills: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        location: { type: SchemaType.STRING },
        certifications: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        employment: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              title: { type: SchemaType.STRING },
              company: { type: SchemaType.STRING },
              period: { type: SchemaType.STRING },
              bullets: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            },
            required: ['title', 'company', 'period', 'bullets'],
          },
        },
      },
      required: ['profile', 'skills', 'location', 'certifications', 'employment'],
    },
  },
  required: ['obtainability', 'obtainabilityReason', 'coverLetter', 'cv'],
};

export interface GeneratorOutput {
  obtainability: number;
  obtainabilityReason: string;
  coverLetter: string;
  cv: TailoredCV;
}

// Gemini 2.5 Flash free tier: 10 RPM. One call per job = need ≥6s between calls.
const GEMINI_DELAY_MS = 7000;
let lastCallAt = 0;

async function geminiRateLimit(): Promise<void> {
  const wait = GEMINI_DELAY_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export async function generateForJob(job: RawJob, cvBaseYaml: string, globalConfig: Record<string, unknown>): Promise<GeneratorOutput> {
  await geminiRateLimit();
  const contentBudget = (globalConfig.cv as Record<string, unknown>)?.content_budget as Record<string, number> ?? {};
  const recentBullets = contentBudget.recent_role_bullets ?? 4;
  const olderBullets = contentBudget.older_role_bullets ?? 2;

  const model = genai.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  const prompt = `You are a professional CV writer and recruitment specialist for UK data/BI roles. You are tailoring a CV and writing a cover letter for Akin Yavuz applying to a specific job.

## CANDIDATE CV (YAML)
${cvBaseYaml}

## JOB DETAILS
Title: ${job.title}
Company: ${job.company ?? 'Not specified'}
Location: ${job.location ?? 'Remote UK'}
Salary: ${formatSalary(job.salaryMin, job.salaryMax)}
Description:
${job.description ?? 'Not available'}

## YOUR TASKS

### 1. Obtainability score (0–100)
How likely is Akin to be shortlisted based on his CV vs this JD?
- 80–100: Strong overlap (Power BI + SQL + Azure in JD), correct seniority (Senior/Principal/Lead), direct employer posting
- 60–79: Good overlap with 1–2 minor gaps, or adjacent seniority
- 40–59: Partial match, notable skill gaps (Databricks/dbt heavy), or vague agency spec
- <40: Weak match, very different role profile, or Director/Head-of requiring people management at scale

### 2. Tailored CV JSON
Adapt the CV to maximise ATS keyword match for this specific JD:
- Profile: ≤${contentBudget.profile_sentences ?? 4} sentences. Naturally mirror 2–3 key phrases from JD. Do NOT invent experience.
- Skills: Reorder so most relevant to THIS JD come first. Add any legitimate keywords from JD that match Akin's actual experience.
- Employment — recent roles (NHS, Openwork, Good Energy): max ${recentBullets} bullets each. Rephrase to mirror JD terminology where truthful.
- Employment — older roles (Holloway, 7 Layer, Car2U): max ${olderBullets} bullets each.
- Location: Use "United Kingdom (Remote)"
- Certifications: keep all, reorder if relevant
- DO NOT invent technologies, metrics, or experience not in the base CV.
- CONTENT BUDGET: profile ≤${contentBudget.profile_sentences ?? 4} sentences, total bullets across all roles ≤22. This must fit 2 A4 pages.

### 3. Cover letter
One paragraph, ~100 words. Tone: confident and direct, no filler phrases ("I am writing to apply...").
- Reference 1–2 specific quantified achievements from the CV
- Mirror 2–3 key phrases from the JD naturally
- End with a forward-looking sentence

Return ONLY valid JSON matching the schema.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text) as GeneratorOutput;

  // Clamp obtainability to 0-100
  parsed.obtainability = Math.max(0, Math.min(100, parsed.obtainability));
  return parsed;
}

export function mergeIntoScoredJob(job: RawJob, output: GeneratorOutput): ScoredJob {
  return {
    ...job,
    obtainability: output.obtainability,
    obtainabilityReason: output.obtainabilityReason,
  };
}

function formatSalary(min: number | null, max: number | null): string {
  if (!min && !max) return 'Not specified';
  if (min && max) return `£${min.toLocaleString('en-GB')} – £${max.toLocaleString('en-GB')} per annum`;
  if (max) return `Up to £${max.toLocaleString('en-GB')} per annum`;
  return `From £${min!.toLocaleString('en-GB')} per annum`;
}
