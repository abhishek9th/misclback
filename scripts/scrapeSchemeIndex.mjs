/**
 * Stage 1 of the myScheme scraper: builds the master index of every scheme
 * (slug, name, category tags, short description) by paginating through every
 * ministry and state/UT listing on myscheme.gov.in.
 *
 * Why headless Playwright instead of curl/fetch: myscheme.gov.in's WAF blocks
 * raw HTTP requests to its Next.js data endpoints (returns the HTML app shell
 * instead of JSON), but a real rendered browser session — confirmed via both
 * the interactive Browser pane and a fresh headless Playwright instance with
 * no special cookies — passes the bot check and gets real data. Pagination on
 * this site is client-side (clicking a page-number <li>, not a URL param), so
 * this drives that click and reads the DOM after each page settles.
 *
 * Resumable: writes progress after every category to scheme_index.progress.json
 * so a crash/interrupt doesn't lose completed categories.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT_DIR = process.argv[2] || './data/myscheme-scrape';
fs.mkdirSync(OUT_DIR, { recursive: true });
const PROGRESS_FILE = path.join(OUT_DIR, 'scheme_index.progress.json');
const FINAL_FILE = path.join(OUT_DIR, 'scheme_index.json');
const CATEGORIES_FILE = path.join(OUT_DIR, 'categories.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return { completedCategories: [], schemes: {} };
}

function saveProgress(state) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(state));
}

async function getCategories(page) {
  if (fs.existsSync(CATEGORIES_FILE)) {
    return JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8'));
  }

  const parseBlock = (text, countRegex) => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(countRegex);
      if (m && i > 0) out.push({ name: lines[i - 1], count: Number(m[1]) });
    }
    return out;
  };

  await page.goto('https://www.myscheme.gov.in/search/ministry/all-ministries', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(2500);
  const ministryText = await page.evaluate(() => document.body.innerText);
  const ministries = parseBlock(ministryText, /^(\d+)\s+Schemes?$/i);

  await page.goto('https://www.myscheme.gov.in/search/state/all-states', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(3000);
  const stateText = await page.evaluate(() => document.body.innerText);
  const states = parseBlock(stateText, /^(\d+)\s+(State\/UT|UT)$/i);

  const categories = {
    ministries: ministries.filter((m) => m.count > 0),
    states: states.filter((s) => s.count > 0),
  };
  fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(categories, null, 2));
  return categories;
}

// Extract scheme cards on the CURRENT rendered page (name, slug, tags, description).
async function extractCurrentPageCards(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href^="/schemes/"]'));
    return links.map((a) => {
      const slug = a.getAttribute('href').replace('/schemes/', '');
      // The card is the closest ancestor block; walk up to grab its text.
      let card = a.closest('div');
      // Heuristic: go up a couple levels to capture description + tags siblings
      for (let i = 0; i < 3 && card && card.parentElement; i++) {
        if (card.innerText && card.innerText.length > 40) break;
        card = card.parentElement;
      }
      const text = card ? card.innerText : a.innerText;
      const linesArr = text.split('\n').map((l) => l.trim()).filter(Boolean);
      return { slug, rawCardText: linesArr };
    });
  });
}

async function getTotalPages(page) {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('li'));
    const nums = all
      .filter((el) => /^\d+$/.test(el.textContent.trim()) && el.className.includes('rounded-full'))
      .map((el) => Number(el.textContent.trim()));
    return nums.length ? Math.max(...nums) : 1;
  });
}

async function clickPage(page, n) {
  return page.evaluate((num) => {
    const all = Array.from(document.querySelectorAll('li'));
    const li = all.find((el) => el.textContent.trim() === String(num) && el.className.includes('rounded-full'));
    if (li) { li.click(); return true; }
    return false;
  }, n);
}

async function extractSlugSet(page) {
  const cards = await extractCurrentPageCards(page);
  return new Set(cards.map((c) => c.slug));
}

async function scrapeCategoryListing(page, url, categoryLabel, schemesAcc) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(2000);

  const totalPages = await getTotalPages(page);
  let pagesScraped = 0;
  let prevSlugs = new Set();

  for (let p = 1; p <= totalPages; p++) {
    if (p > 1) {
      const ok = await clickPage(page, p);
      if (!ok) break;
      // Poll until the card set actually changes from the previous page
      // (client-side pagination re-fetches asynchronously) or we time out.
      let curSlugs = await extractSlugSet(page);
      let waited = 0;
      while (waited < 5000 && setsEqual(curSlugs, prevSlugs)) {
        await sleep(400);
        waited += 400;
        curSlugs = await extractSlugSet(page);
      }
    }
    const cards = await extractCurrentPageCards(page);
    const curSlugs = new Set(cards.map((c) => c.slug));
    for (const c of cards) {
      if (!schemesAcc[c.slug]) {
        schemesAcc[c.slug] = { slug: c.slug, categories: [], rawCardText: c.rawCardText };
      }
      if (!schemesAcc[c.slug].categories.includes(categoryLabel)) {
        schemesAcc[c.slug].categories.push(categoryLabel);
      }
    }
    prevSlugs = curSlugs;
    pagesScraped++;
  }
  return pagesScraped;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: UA });

  const categories = await getCategories(page);
  const allCategoryJobs = [
    ...categories.ministries.map((m) => ({
      type: 'ministry',
      name: m.name,
      count: m.count,
      url: `https://www.myscheme.gov.in/search/ministry/${encodeURIComponent(m.name)}`,
    })),
    ...categories.states.map((s) => ({
      type: 'state',
      name: s.name,
      count: s.count,
      url: `https://www.myscheme.gov.in/search/state/${encodeURIComponent(s.name)}`,
    })),
  ];

  const state = loadProgress();
  console.log(`Total categories: ${allCategoryJobs.length}. Already done: ${state.completedCategories.length}.`);

  for (const job of allCategoryJobs) {
    const jobKey = `${job.type}:${job.name}`;
    if (state.completedCategories.includes(jobKey)) continue;

    let attempt = 0;
    let success = false;
    while (attempt < 3 && !success) {
      attempt++;
      try {
        const pages = await scrapeCategoryListing(page, job.url, jobKey, state.schemes);
        console.log(`[OK] ${jobKey} (expected ${job.count}) — ${pages} pages, total unique schemes so far: ${Object.keys(state.schemes).length}`);
        success = true;
      } catch (err) {
        console.error(`[RETRY ${attempt}] ${jobKey}:`, err.message);
        await sleep(3000);
      }
    }
    if (success) {
      state.completedCategories.push(jobKey);
      saveProgress(state);
    } else {
      console.error(`[FAILED] ${jobKey} after 3 attempts — skipping, will need manual retry`);
    }
  }

  fs.writeFileSync(FINAL_FILE, JSON.stringify(Object.values(state.schemes), null, 2));
  console.log(`\nDONE. Unique schemes: ${Object.keys(state.schemes).length}`);
  console.log(`Written to ${FINAL_FILE}`);

  await browser.close();
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
