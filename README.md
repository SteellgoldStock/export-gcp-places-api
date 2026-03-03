# export-gcp-places-api

A Node.js CLI tool to bulk-export notable places and landmarks from the [Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service/op-overview) for the **Alsace region** (France). It collects churches, museums, castles, monuments, stadiums, universities, libraries, town halls, and more -- then outputs a clean, normalized JSON file.

## How it works

The export runs in three phases:

1. **Priority Cities** -- Searches specifically in Mulhouse, Strasbourg, and Colmar until a target count is reached.
2. **Global Search** -- Broadens to the entire Alsace bounding box (lat 47.35-49.15, lng 6.70-8.35) to fill up to the max places limit.
3. **Description Enrichment** *(optional)* -- Makes individual Place Details API calls for places missing an editorial summary.

Duplicates are automatically filtered by Google Place ID.

## Prerequisites

- **Node.js** v18+ (native `fetch` required)
- **pnpm**
- A **Google Cloud API key** with access to the [Places API (New)](https://developers.google.com/maps/documentation/places/web-service/overview)

## Setup

```bash
git clone https://github.com/SteellgoldStock/export-gcp-places-api.git
cd export-gcp-places-api
pnpm install
```

Copy the environment template and add your API key:

```bash
cp .env.example .env
```

Then edit `.env`:

```
PLACES_API_KEY=your_google_places_api_key_here
```

## Usage

### Quick start

```bash
# Full export with description enrichment
pnpm start

# Fast export without description enrichment (fewer API calls)
pnpm test
```

### Custom run

```bash
node index.js [options]
```

| Option | Default | Description |
|---|---|---|
| `--max-places` | `1000` | Maximum total places to collect |
| `--priority-target` | `350` | Target count for the priority cities phase |
| `--max-requests` | `400` | Safety limit on Text Search API requests |
| `--max-detail-requests` | `1000` | Safety limit on Place Details API requests |
| `--detail-delay` | `500` | Delay (ms) between Place Details requests |
| `--enable-descriptions` | `true` | Enable/disable description enrichment (`true`/`false`) |
| `--output` | `data_export_<timestamp>.json` | Output file path |

**Examples:**

```bash
# Export up to 100 places, no descriptions
node index.js --max-places=100 --enable-descriptions=false

# Export to a specific file
node index.js --output=my_export.json

# Small run for testing
node index.js --max-places=10 --priority-target=5 --max-requests=20
```

## Output format

The output is a JSON file with the following structure:

```json
{
  "meta": {
    "bounds": {
      "low": { "latitude": 47.35, "longitude": 6.7 },
      "high": { "latitude": 49.15, "longitude": 8.35 }
    },
    "max_places": 1000,
    "priority_cities": ["Mulhouse", "Strasbourg", "Colmar"],
    "priority_target": 350,
    "search_requests": 59,
    "enrichment": {
      "detail_requests": 93,
      "descriptions_found": 0,
      "descriptions_failed": 0,
      "total_with_description": 7
    }
  },
  "places": [
    {
      "id_google": "ChIJDdLOJXWbkUcRoqzJY9JtC8o",
      "name": "Temple Saint-Etienne",
      "description": "An editorial summary or null",
      "formatted_address": "12 Pl. de la Reunion, 68100 Mulhouse, France",
      "postal_code": "68100",
      "locality": "Mulhouse",
      "region": "Grand Est",
      "country": "France",
      "lat": 47.7471041,
      "lng": 7.3388015,
      "primary_type": "church",
      "types": ["tourist_attraction", "church", "place_of_worship"],
      "rating": 4.4,
      "user_rating_count": 1584,
      "photo_urls": [
        "https://places.googleapis.com/v1/places/.../media?maxWidthPx=800&key=..."
      ],
      "photo_count": 2
    }
  ]
}
```

A sample output file is included at [`places_demo.json`](places_demo.json).

## API cost & rate limiting

The script includes several safeguards to control API usage:

- `--max-requests` caps the number of Text Search calls
- `--max-detail-requests` caps Place Details calls
- `--detail-delay` throttles between detail requests (default 500ms)
- A 1000ms delay is applied between paginated search requests
- Disable enrichment entirely with `--enable-descriptions=false` to skip all Place Details calls

## Project structure

```
export-gcp-places-api/
├── index.js           # Entire application (single-file)
├── package.json       # Scripts and dependencies
├── .env.example       # Environment variable template
├── .gitignore
├── places_demo.json   # Sample output (3 places)
└── README.md
```

## License

ISC
