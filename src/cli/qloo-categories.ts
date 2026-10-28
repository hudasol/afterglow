/**
 * A read only check of how each venue category resolves on Qloo and how many places the
 * category tag returns in a city. It writes no results file and needs QLOO_API_KEY.
 *
 *   npm run qloo:categories -- Chicago Berlin
 *   npm run qloo:categories -- --phrases "dessert shop,bakery" Chicago Berlin
 *
 * With --phrases the listed phrases are checked in place of the product's category phrases.
 *
 * Every value printed is a count, a public tag name or an identifier.
 */
import type { CallTrace } from '../domain/case.js';
import { categoryTagPhrase, venueCategorySchema } from '../domain/intent.js';
import { liveClient } from '../evaluation/live-scenarios.js';
import { resultArray, toEntityRef } from '../qloo/normalize.js';
import { PLACE_TYPE, resolveTag } from '../qloo/resolve.js';

interface Row {
  category: string;
  phrase: string;
  status: string;
  tag: string;
  type: string | null;
  city: string;
  places: number;
  sample: string[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const phraseIndex = args.indexOf('--phrases');
  const custom =
    phraseIndex === -1
      ? null
      : (args[phraseIndex + 1] ?? '')
          .split(',')
          .map((phrase) => phrase.trim())
          .filter(Boolean);
  const cities = args.filter(
    (arg, index) => arg !== '--phrases' && (phraseIndex === -1 || index !== phraseIndex + 1),
  );
  if (cities.length === 0) throw new Error('Usage: qloo-categories [--phrases a,b] <city> ...');
  const client = liveClient();
  if (!client) {
    console.error('QLOO_API_KEY is not set, so nothing was requested.');
    process.exitCode = 2;
    return;
  }
  const rows: Row[] = [];
  const subjects = custom
    ? custom.map((phrase) => ({ category: 'custom', phrase }))
    : venueCategorySchema.options.map((category) => ({
        category: category as string,
        phrase: categoryTagPhrase[category],
      }));
  for (const { category, phrase } of subjects) {
    const resolution = await resolveTag(client, 'category', phrase, [] as CallTrace[], PLACE_TYPE);
    const tags = [
      ...(resolution.selected ? [resolution.selected] : []),
      ...(resolution.alsoUsed ?? []),
      ...(resolution.candidates ?? []),
    ];
    for (const tag of tags) {
      for (const city of cities) {
        let places = 0;
        let sample: string[];
        try {
          const response = await client.get(
            '/v2/insights',
            {
              'filter.type': PLACE_TYPE,
              'filter.location.query': city,
              'filter.tags': tag.id,
              take: 20,
            },
            [] as CallTrace[],
          );
          const refs = resultArray(response, 'entities')
            .map(toEntityRef)
            .filter((ref): ref is NonNullable<typeof ref> => ref !== undefined);
          places = refs.length;
          sample = refs.slice(0, 4).map((ref) => ref.name);
        } catch (error) {
          sample = [error instanceof Error ? error.message.slice(0, 80) : 'failed'];
        }
        rows.push({
          category,
          phrase,
          status: resolution.status,
          tag: tag.id,
          type: tag.type ?? null,
          city,
          places,
          sample,
        });
      }
    }
  }
  console.log('-----BEGIN CATEGORIES-----');
  console.log(JSON.stringify(rows, null, 2));
  console.log('-----END CATEGORIES-----');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
