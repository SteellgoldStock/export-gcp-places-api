// export_places_alsace_priority.js
// Run with:
//   pnpm start
//
// CLI arguments (all optional, defaults shown):
//   --max-places=1000          Maximum total places to collect
//   --priority-target=350      Target count for priority cities
//   --max-requests=400         Safety limit on Text Search API requests
//   --max-detail-requests=1000 Safety limit on Place Details requests (for descriptions)
//   --detail-delay=500         Delay in ms between Place Details requests
//   --enable-descriptions=true Enable Place Details enrichment for missing descriptions
//   --output                   Output file path (default: data_export_<unix>.json)

require("dotenv").config();
const fs = require("fs");
const path = require("path");

// --- Parse CLI arguments ---
function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const match = arg.match(/^--([a-z-]+)=(.+)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

const cliArgs = parseArgs(process.argv);

const API_KEY = process.env.PLACES_API_KEY;
if (!API_KEY) {
  console.error("Missing PLACES_API_KEY env var");
  process.exit(1);
}

// Alsace bounding box
const ALSACE_BOUNDS = {
  low: { latitude: 47.35, longitude: 6.70 },
  high: { latitude: 49.15, longitude: 8.35 },
};

// Priority cities
const PRIORITY_CITIES = ["Mulhouse", "Strasbourg", "Colmar"];

// Place types / categories we want
const CITY_QUERIES = [
  "church",
  "cathedral",
  "museum",
  "monument",
  "historic building",
  "town hall",
  "university",
  "library",
  "castle",
  "stadium",
];

const GLOBAL_QUERIES = [
  "museum",
  "monument",
  "historic building",
  "church",
  "cathedral",
  "castle",
  "stadium",
  "library",
  "university",
];

// Global config
const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.addressComponents",
  "places.primaryType",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "places.editorialSummary",
  "places.photos",
  "nextPageToken",
].join(",");

const MAX_PLACES = parseInt(cliArgs["max-places"] || "1000", 10);
const PRIORITY_TARGET = parseInt(cliArgs["priority-target"] || "350", 10);
const MAX_REQUESTS = parseInt(cliArgs["max-requests"] || "400", 10);
const MAX_DETAIL_REQUESTS = parseInt(cliArgs["max-detail-requests"] || "1000", 10);
const DETAIL_DELAY = parseInt(cliArgs["detail-delay"] || "500", 10);
const ENABLE_DESCRIPTIONS = (cliArgs["enable-descriptions"] || "true") === "true";
const OUTPUT_FILE = path.join(
  __dirname,
  cliArgs["output"] || `data_export_${Math.floor(Date.now() / 1000)}.json`
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAddressComponent(components, typeKey) {
  if (!Array.isArray(components)) return null;
  for (const comp of components) {
    const types = comp.types || [];
    if (types.includes(typeKey)) {
      return comp.longText || comp.shortText || null;
    }
  }
  return null;
}

function normalizePlace(raw) {
  const addrComponents = raw.addressComponents || [];
  const photos = raw.photos || [];

  const selected = photos.slice(0, 5);
  // console.log("---------------");
  // console.log("---------------");
  // console.log("---------------");

  // console.log("Raw place data:", JSON.stringify(raw, null, 2));

  // console.log("---------------");
  // console.log("---------------");
  // console.log("---------------");

  const photoUrls = selected
    .filter((p) => p && p.name)
    .map((p) => `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=800&key=${API_KEY}`);

  const loc = raw.location || {};
  const displayName = raw.displayName || {};

  const locality = extractAddressComponent(addrComponents, "locality");

  // Extract editorial summary if available from Text Search
  const editorial = raw.editorialSummary || {};
  const description = editorial.text || null;

  return {
    id_google: raw.id || null,
    name: displayName.text || null,
    description,
    formatted_address: raw.formattedAddress || null,
    postal_code: extractAddressComponent(addrComponents, "postal_code"),
    locality,
    region: extractAddressComponent(
      addrComponents,
      "administrative_area_level_1"
    ),
    country: extractAddressComponent(addrComponents, "country"),
    lat: loc.latitude || null,
    lng: loc.longitude || null,
    primary_type: raw.primaryType || null,
    types: raw.types || [],
    rating: raw.rating || null,
    user_rating_count: raw.userRatingCount || null,
    photo_urls: photoUrls,
    photo_count: photoUrls.length,
  };
}

async function searchOnce(query, pageToken = null) {
  const body = {
    textQuery: query,
    languageCode: "fr",
    locationRestriction: {
      rectangle: {
        low: ALSACE_BOUNDS.low,
        high: ALSACE_BOUNDS.high,
      },
    },
    pageSize: 20,
  };
  if (pageToken) body.pageToken = pageToken;

  const res = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function getPlaceDescription(placeId) {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": "editorialSummary",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();
  const editorial = data.editorialSummary || {};
  return editorial.text || null;
}

async function collectPhase({
  phaseName,
  queries,
  buildTextQuery,
  allPlacesById,
  totalRequestsRef,
  filterFn,
  targetCount = Infinity,
}) {
  console.log(`\n=== Phase: ${phaseName} ===`);

  for (const baseQuery of queries) {
    // For the cities phase, buildTextQuery appends "in <city>"
    const textQueries = buildTextQuery(baseQuery);

    for (const textQuery of textQueries) {
      console.log(`--- textQuery: "${textQuery}" ---`);
      let pageToken = null;

      while (true) {
        if (allPlacesById.size >= MAX_PLACES) {
          console.log("MAX_PLACES reached, stopping globally.");
          return;
        }
        if (totalRequestsRef.value >= MAX_REQUESTS) {
          console.log("MAX_REQUESTS reached, stopping globally.");
          return;
        }
        if (allPlacesById.size >= targetCount && phaseName !== "global") {
          // For the priority phase, we can exit once the target is reached
          console.log(`Phase "${phaseName}" target reached (${targetCount}), moving on.`);
          return;
        }

        totalRequestsRef.value++;
        const data = await searchOnce(textQuery, pageToken);
        const places = data.places || [];
        console.log(`- Page: ${places.length} results`);

        for (const place of places) {
          const pid = place.id;
          if (!pid) continue;
          if (allPlacesById.has(pid)) continue;

          const normalized = normalizePlace(place);

          if (filterFn && !filterFn(normalized)) {
            continue;
          }

          // To enforce a minimum of 3 photos, uncomment:
          // if (normalized.photo_count < 3) continue;

          allPlacesById.set(pid, normalized);

          if (allPlacesById.size >= MAX_PLACES) return;
          if (allPlacesById.size >= targetCount && phaseName !== "global") return;
        }

        pageToken = data.nextPageToken;
        if (!pageToken) break;

        await sleep(1000);
      }
    }
  }
}

async function enrichDescriptions(places) {
  const needDescription = places.filter((p) => !p.description);
  const alreadyHave = places.length - needDescription.length;

  console.log(`\n=== Phase: enrich-descriptions ===`);
  console.log(`Already have description: ${alreadyHave}/${places.length}`);
  console.log(`Need description: ${needDescription.length}`);
  console.log(`Max detail requests allowed: ${MAX_DETAIL_REQUESTS}`);

  let requestCount = 0;
  let enrichedCount = 0;
  let failedCount = 0;

  for (const place of needDescription) {
    if (requestCount >= MAX_DETAIL_REQUESTS) {
      console.log(`MAX_DETAIL_REQUESTS reached (${MAX_DETAIL_REQUESTS}), stopping enrichment.`);
      break;
    }

    requestCount++;
    const progress = `[${requestCount}/${needDescription.length}]`;

    try {
      const description = await getPlaceDescription(place.id_google);

      if (description) {
        place.description = description;
        enrichedCount++;
        const preview = description.length > 60 ? description.substring(0, 60) + "..." : description;
        console.log(`${progress} ${place.name} -> "${preview}"`);
      } else {
        console.log(`${progress} ${place.name} -> no description available`);
      }
    } catch (err) {
      failedCount++;
      console.error(`${progress} ${place.name} -> ERROR: ${err.message}`);
    }

    if (requestCount < needDescription.length) {
      await sleep(DETAIL_DELAY);
    }
  }

  const totalWithDesc = places.filter((p) => p.description).length;
  console.log(`\n--- Enrichment summary ---`);
  console.log(`Detail requests made: ${requestCount}`);
  console.log(`New descriptions found: ${enrichedCount}`);
  console.log(`Failed requests: ${failedCount}`);
  console.log(`Total with description: ${totalWithDesc}/${places.length}`);

  return { requestCount, enrichedCount, failedCount, totalWithDesc };
}

async function exportAlsacePlacesPriority() {
  const allPlacesById = new Map();
  const totalRequestsRef = { value: 0 };

  // Phase 1: Priority cities — Mulhouse / Strasbourg / Colmar
  await collectPhase({
    phaseName: "priority-cities",
    queries: CITY_QUERIES,
    buildTextQuery: (baseQuery) =>
      PRIORITY_CITIES.map((city) => `${baseQuery} in ${city}, France`),
    allPlacesById,
    totalRequestsRef,
    filterFn: (place) => PRIORITY_CITIES.includes(place.locality || ""),
    targetCount: PRIORITY_TARGET,
  });

  console.log(
    `After priority cities phase: ${allPlacesById.size} places, requests: ${totalRequestsRef.value}`
  );

  if (allPlacesById.size < MAX_PLACES && totalRequestsRef.value < MAX_REQUESTS) {
    // Phase 2: Rest of Alsace (global)
    await collectPhase({
      phaseName: "global",
      queries: GLOBAL_QUERIES,
      buildTextQuery: (baseQuery) => [baseQuery],
      allPlacesById,
      totalRequestsRef,
      filterFn: null,
      targetCount: MAX_PLACES,
    });
  }

  console.log(
    `\nTotal unique places exported: ${allPlacesById.size}, search requests: ${totalRequestsRef.value}`
  );

  const places = Array.from(allPlacesById.values());

  // Phase 3: Enrich missing descriptions via Place Details
  let enrichment = null;
  if (ENABLE_DESCRIPTIONS) {
    enrichment = await enrichDescriptions(places);
  } else {
    console.log("\nDescription enrichment disabled (--enable-descriptions=false)");
  }

  const output = {
    meta: {
      bounds: ALSACE_BOUNDS,
      max_places: MAX_PLACES,
      priority_cities: PRIORITY_CITIES,
      priority_target: PRIORITY_TARGET,
      search_requests: totalRequestsRef.value,
      ...(enrichment && {
        enrichment: {
          detail_requests: enrichment.requestCount,
          descriptions_found: enrichment.enrichedCount,
          descriptions_failed: enrichment.failedCount,
          total_with_description: enrichment.totalWithDesc,
        },
      }),
    },
    places,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf8");
  console.log(`\nExport written to ${OUTPUT_FILE}`);
}

exportAlsacePlacesPriority().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
