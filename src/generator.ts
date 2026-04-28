import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';
import type { RawJob, ScoredJob, TailoredCV } from './types.js';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

export interface GeneratorOutput {
  obtainability: number;
  obtainabilityReason: string;
  coverLetter: string;
  cv: TailoredCV;
  keyProjects?: { name: string; description: string }[];
}

export async function generateForJob(
  job: RawJob,
  cvBaseYaml: string,
  globalConfig: Record<string, unknown>
): Promise<GeneratorOutput> {
  const contentBudget = (globalConfig.cv as Record<string, unknown>)?.content_budget as Record<string, number> ?? {};
  const recentBullets = contentBudget.recent_role_bullets ?? 6;
  const olderBullets = contentBudget.older_role_bullets ?? 4;
  const profileSentences = contentBudget.profile_sentences ?? 5;
  const keyProjectsCount = contentBudget.key_projects ?? 3;
  const keyProjectWords = contentBudget.key_project_words ?? 70;

  const userPrompt = `Tailor Akin Yavuz's CV for the following job and return a JSON object.

## JOB DETAILS
Title: ${job.title}
Company: ${job.company ?? 'Not specified'}
Location: ${job.location ?? 'Remote UK'}
Salary: ${formatSalary(job.salaryMin, job.salaryMax)}
Description:
${(job.description ?? 'Not available').slice(0, 3000)}

## INSTRUCTIONS

### obtainability (integer 0-100)
How likely is Akin to be shortlisted based on his CV vs this JD?
- 80-100: Strong overlap (Power BI + SQL + Azure in JD), correct seniority (Senior/Principal/Lead), direct employer
- 60-79: Good overlap with 1-2 minor gaps, or adjacent seniority
- 40-59: Partial match, notable gaps (Databricks/dbt heavy), or vague agency spec
- <40: Weak match, very different role profile, Director/Head requiring people management at scale

### obtainabilityReason (string, 1-2 sentences)
Brief reason for the score.

### coverLetter (string, ~100 words)
One paragraph. Confident and direct — no "I am writing to apply". Reference 1-2 specific quantified achievements. Mirror 2-3 key phrases from the JD naturally. End with a forward-looking sentence.

### cv (object)
- profile: string, max ${profileSentences} sentences. Mirror 2-3 JD keywords naturally. Do NOT invent experience.
- skills: string[], reorder most relevant to THIS JD first. Add legitimate keywords from JD that match Akin's actual experience.
- location: use "United Kingdom (Remote)"
- certifications: string[], keep all, reorder if relevant
- employment: array of roles. Recent roles (NHS, Openwork, Good Energy): max ${recentBullets} bullets. Older roles (Holloway, 7 Layer, Car2U): max ${olderBullets} bullets. Rephrase to mirror JD terminology where truthful. TOTAL bullets across ALL roles must be ≤34 (fills 2 A4 pages). Do NOT invent technologies or metrics.

### keyProjects (array of ${keyProjectsCount} objects)
Select the ${keyProjectsCount} most relevant of Akin's key projects from his CV base and tailor the descriptions to the job description. Each object has:
- name: string (project name)
- description: string (max ${keyProjectWords} words, tailored to JD — write full sentences, do not truncate early)

## REQUIRED JSON SCHEMA
{
  "obtainability": <integer>,
  "obtainabilityReason": <string>,
  "coverLetter": <string>,
  "cv": {
    "profile": <string>,
    "skills": [<string>],
    "location": <string>,
    "certifications": [<string>],
    "employment": [
      {
        "title": <string>,
        "company": <string>,
        "period": <string>,
        "bullets": [<string>]
      }
    ]
  },
  "keyProjects": [
    {
      "name": <string>,
      "description": <string>
    }
  ]
}

Return ONLY the JSON object. No markdown. No explanation.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    // System blocks: stable content cached after the first call
    system: [
      {
        type: 'text',
        text: 'You are a professional CV writer and UK recruitment specialist for data/BI roles.\nYou tailor CVs to specific job descriptions and write concise cover letters.\nYou always respond with valid JSON only — no markdown, no code fences, no explanation.',
      },
      {
        type: 'text',
        text: `## CANDIDATE CV (YAML)\n${cvBaseYaml}`,
        cache_control: { type: 'ephemeral' }, // caches system prompt + cv-base YAML together
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = response.content.find((b) => b.type === 'text');
  const text = block?.type === 'text' ? block.text : '{}';
  const parsed = JSON.parse(text) as GeneratorOutput;
  parsed.obtainability = Math.max(0, Math.min(100, Number(parsed.obtainability) || 0));
  return parsed;
}

export function mergeIntoScoredJob(job: RawJob, output: GeneratorOutput): ScoredJob {
  return { ...job, obtainability: output.obtainability, obtainabilityReason: output.obtainabilityReason };
}

function formatSalary(min: number | null, max: number | null): string {
  if (!min && !max) return 'Not specified';
  if (min && max) return `£${min.toLocaleString('en-GB')} – £${max.toLocaleString('en-GB')} per annum`;
  if (max) return `Up to £${max.toLocaleString('en-GB')} per annum`;
  return `From £${min!.toLocaleString('en-GB')} per annum`;
}
