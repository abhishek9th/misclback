/**
 * Loads the scraped myscheme.gov.in index (+ detail data, if available) and
 * upserts it into public.myscheme_catalogue via the Supabase service role.
 * Safe to re-run: every row is upserted by slug (primary key), so re-running
 * after the detail scraper makes more progress just fills in more fields.
 *
 * Requires supabase/migrations/20260922_myscheme_catalogue.sql to have been
 * run already (see backend README / pending_migrations note).
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATA_DIR = process.argv[2] || './backend/data/myscheme-scrape';
const BATCH_SIZE = 500;

function loadJsonMaybe(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function buildRows(dataDir) {
  const indexFinal = loadJsonMaybe(path.join(dataDir, 'scheme_index.json'));
  const indexProgress = loadJsonMaybe(path.join(dataDir, 'scheme_index.progress.json'));
  const indexSchemes = indexFinal || (indexProgress ? Object.values(indexProgress.schemes) : null);
  if (!indexSchemes) throw new Error('No scheme_index.json or scheme_index.progress.json found');

  const detailsFinal = loadJsonMaybe(path.join(dataDir, 'scheme_details.json'));
  const detailsProgress = loadJsonMaybe(path.join(dataDir, 'scheme_details.progress.json'));
  const detailsBySlug = detailsFinal
    ? Object.fromEntries(detailsFinal.map((d) => [d.slug, d]))
    : (detailsProgress || {});

  const rows = [];
  for (const s of indexSchemes) {
    const ministries = [];
    const states = [];
    for (const c of s.categories || []) {
      if (c.startsWith('ministry:')) ministries.push(c.slice('ministry:'.length));
      else if (c.startsWith('state:')) states.push(c.slice('state:'.length));
    }
    const [name, ministryLine, shortDescription] = s.rawCardText || [];
    const detail = detailsBySlug[s.slug];

    if (detail && detail.notFound) continue; // dead slug on the source site — skip

    const row = {
      slug: s.slug,
      name: (detail && detail.name) || name || s.slug,
      short_description: shortDescription || null,
      level: states.length > 0 ? 'state' : 'central',
      ministries,
      states,
      source_url: `https://www.myscheme.gov.in/schemes/${s.slug}`,
    };

    if (detail && !detail.notFound) {
      row.details_text = detail.detail_text?.details || null;
      row.eligibility_text = detail.detail_text?.eligibility || null;
      row.benefits_text = detail.detail_text?.benefits || null;
      row.application_process = detail.detail_text?.application_process
        ? JSON.stringify([detail.detail_text.application_process])
        : null;
      row.documents_required = detail.detail_text?.documents_required
        ? JSON.stringify([detail.detail_text.documents_required])
        : null;
      row.faqs = detail.detail_text?.faqs_raw ? JSON.stringify([detail.detail_text.faqs_raw]) : null;
      row.official_website = detail.official_website || null;
      row.detail_scraped_at = detail.detail_scraped_at || null;
    }

    rows.push(row);
  }
  return rows;
}

async function run() {
  const rows = buildRows(DATA_DIR);
  console.log(`Prepared ${rows.length} rows from ${DATA_DIR}`);

  const supabase = getSupabaseAdmin();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('myscheme_catalogue').upsert(batch, { onConflict: 'slug' });
    if (error) {
      console.error(`Batch ${i}-${i + batch.length} FAILED:`, error.message);
      throw error;
    }
    upserted += batch.length;
    console.log(`Upserted ${upserted}/${rows.length}`);
  }
  console.log('DONE.');
}

run().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
