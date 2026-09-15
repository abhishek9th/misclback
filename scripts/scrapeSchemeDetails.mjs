/**
 * Stage 2 of the myScheme scraper: visits each scheme's own detail page
 * (https://www.myscheme.gov.in/schemes/<slug>) and extracts the full,
 * as-published structured content — eligibility, benefits, application
 * process, documents required, FAQs, official website. Every field here is
 * scraped verbatim from the government's own site, never AI-generated.
 *
 * Input: scheme_index.json (or its progress file) from scrapeSchemeIndex.mjs.
 * Output: scheme_details.progress.json (resumable, written after every
 * scheme) and the final scheme_details.json.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.argv[2] || './backend/data/myscheme-scrape';
const INDEX_FILE = fs.existsSync(path.join(DATA_DIR, 'scheme_index.json'))
  ? path.join(DATA_DIR, 'scheme_index.json')
  : path.join(DATA_DIR, 'scheme_index.progress.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'scheme_details.progress.json');
const FINAL_FILE = path.join(DATA_DIR, 'scheme_details.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SECTION_HEADERS = [
  'Details', 'Benefits', 'Eligibility', 'Exclusions', 'Application Process',
  'Documents Required', 'Frequently Asked Questions', 'Sources And References',
];

function splitIntoSections(fullText) {
  // Find each header as its own line, then slice the text between consecutive headers.
  const lines = fullText.split('\n');
  const markers = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (SECTION_HEADERS.includes(trimmed)) markers.push({ header: trimmed, line: i });
  });
  // A header name can also appear as a nav-tab label earlier in the page —
  // keep only the LAST occurrence of each header (the actual section body follows it).
  const lastByHeader = {};
  for (const m of markers) lastByHeader[m.header] = m.line;
  const ordered = SECTION_HEADERS
    .filter((h) => h in lastByHeader)
    .map((h) => ({ header: h, line: lastByHeader[h] }))
    .sort((a, b) => a.line - b.line);

  const sections = {};
  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i].line + 1;
    const end = i + 1 < ordered.length ? ordered[i + 1].line : lines.length;
    sections[ordered[i].header] = lines.slice(start, end).join('\n').trim();
  }
  return sections;
}

async function scrapeOne(page, slug) {
  const url = `https://www.myscheme.gov.in/schemes/${slug}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await sleep(1800);

  const fullText = await page.evaluate(() => document.body.innerText);
  if (/^Page not found\.?$/m.test(fullText.split('\n').find((l) => l.trim()) || '') || fullText.includes('Page not found.')) {
    return { slug, name: null, notFound: true, source_url: url, detail_scraped_at: new Date().toISOString() };
  }
  const sections = splitIntoSections(fullText);

  const externalLinks = await page.$$eval('a[href^="http"]', (as) =>
    as.map((a) => a.href).filter((h) => !h.includes('myscheme.gov.in') && !h.includes('digitalindia.gov.in') && !h.includes('ux4g.gov.in'))
  );
  const uniqueExternal = [...new Set(externalLinks)];
  const officialWebsite = uniqueExternal.find((h) => /^https?:\/\/[^/]+\/?$/.test(h)) || uniqueExternal[0] || null;

  const name = await page.$$eval('h1', (els) => {
    const withText = els.map((e) => e.textContent.trim()).filter(Boolean);
    return withText[0] || null;
  }).catch(() => null);

  return {
    slug,
    name,
    detail_text: {
      details: sections['Details'] || null,
      benefits: sections['Benefits'] || null,
      eligibility: sections['Eligibility'] || null,
      exclusions: sections['Exclusions'] || null,
      application_process: sections['Application Process'] || null,
      documents_required: sections['Documents Required'] || null,
      faqs_raw: sections['Frequently Asked Questions'] || null,
    },
    official_website: officialWebsite,
    external_links: uniqueExternal,
    source_url: url,
    detail_scraped_at: new Date().toISOString(),
  };
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  return {};
}

async function run() {
  const indexData = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const schemes = Array.isArray(indexData) ? indexData : Object.values(indexData.schemes || {});
  const slugs = schemes.map((s) => s.slug);
  console.log(`Loaded ${slugs.length} scheme slugs from ${INDEX_FILE}`);

  const results = loadProgress();
  console.log(`Already scraped: ${Object.keys(results).length}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: UA });

  let done = Object.keys(results).length;
  for (const slug of slugs) {
    if (results[slug]) continue;

    let attempt = 0;
    let ok = false;
    while (attempt < 3 && !ok) {
      attempt++;
      try {
        const detail = await scrapeOne(page, slug);
        results[slug] = detail;
        ok = true;
      } catch (err) {
        console.error(`[RETRY ${attempt}] ${slug}: ${err.message}`);
        await sleep(2500);
      }
    }
    if (!ok) {
      results[slug] = { slug, error: 'failed after 3 attempts', detail_scraped_at: null };
    }
    done++;
    if (done % 20 === 0 || !ok) {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(results));
      console.log(`[${done}/${slugs.length}] ${slug} ${ok ? 'OK' : 'FAILED'}`);
    }
  }

  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(results));
  fs.writeFileSync(FINAL_FILE, JSON.stringify(Object.values(results), null, 2));
  console.log(`\nDONE. ${Object.keys(results).length} schemes detail-scraped. Written to ${FINAL_FILE}`);

  await browser.close();
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
