import { chromium } from 'playwright';

const DESCRIPTION_THRESHOLD = 800;

export async function fetchFullDescription(url: string, currentDescription: string | null): Promise<string | null> {
  if ((currentDescription?.length ?? 0) >= DESCRIPTION_THRESHOLD) return null; // already full

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB,en;q=0.9' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    const description = await page.evaluate(() => {
      const selectors = [
        '[data-qa="job-description"]',
        '.job-description',
        '#job-description',
        '[class*="jobDescription"]',
        '[class*="job-desc"]',
        '.description',
        'article',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && (el.textContent?.length ?? 0) > 200) return el.textContent?.trim() ?? null;
      }
      return null;
    });

    return description && description.length > (currentDescription?.length ?? 0) ? description : null;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

export function needsFullDescription(description: string | null): boolean {
  return (description?.length ?? 0) < DESCRIPTION_THRESHOLD;
}
