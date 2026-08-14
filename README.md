# CometQuant Lab

Mobile-first PWA for blinded visual scoring and statistical analysis of comet
assay experiments. All experiment data remains in the browser; the application
has no backend or remote database.

## Requirements

- Node.js 20 or newer for development and automated tests.
- Python 3.12 with `requirements-test.txt` for statistical engine tests.
- R 4 or newer only for the optional independent statistical audit.
- Chromium installed by Playwright for browser tests.

## Development

```powershell
npm ci
npx playwright install chromium
python -m pip install -r requirements-test.txt
npm run check
npm test
npm run test:analysis
npm run test:reference:r
npm run test:e2e
```

`npm ci` copies JSZip to `vendor/` so ZIP exports work in static deployments.
Use `npx http-server . -p 4173 -c-1` to run the application locally.

## Architecture

- `index.html` and `css/style.css`: static application shell and responsive UI.
- `js/app.js`: navigation, blinded counting and transactional local persistence.
- `js/backup.js`: password-based encrypted backup envelopes for active blinding.
- `js/core.js`: schema migration, validation, scoring, aggregation and merge.
- `js/analysis.js`: Pyodide bridge, result rendering and analysis exports.
- `python/cometquant_analysis.py`: statistical engine used by both Pyodide and Python tests.
- `js/export.js`: safe JSON, CSV, HTML and ZIP builders.
- `service-worker.js`: application-shell cache for the PWA.

Scripts are loaded as classic browser scripts, so their order in `index.html`
is significant.

## Data And Blinding

The current experiment schema is version 3. Each replicate contains a complete
mapping of blind assignments and counted slides. Assignment states are
`pending`, `counting`, `counted` or `absent`.

Counts are committed to `localStorage` after every increment and undo. Terminal
operations only advance the interface after a successful validated write.
Unknown, future-version and malformed entries are not silently removed when a
valid experiment is saved.

Blinding prevents accidental disclosure in the normal UI. It is not
cryptographic protection: treatment mappings remain present in local browser
storage. Revealing summaries, analyses and exports remain blocked while slides
are pending.

While blinding is active, the experiment list offers an encrypted backup instead
of plaintext JSON export. The envelope uses PBKDF2-SHA-256 with 600,000
iterations and AES-256-GCM with random salt and IV. The password is never stored
and cannot be recovered. Import detects `.cqbackup.json` files and decrypts them
before normal schema validation.

The encrypted envelope protects a copied backup file against offline inspection
when a strong passphrase is used. It does not protect against someone with
access to the unlocked browser profile, malicious extensions, screen capture or
code executing in the application origin. The externally loaded Pyodide runtime
is therefore part of the trusted computing base and should be hosted locally
before handling data with stricter confidentiality requirements.

## Statistical Protocol

Technical slides are averaged within each replicate before inferential tests,
so the replicate remains the experimental unit. Incomplete and absent slides
are retained for traceability but excluded from analysis.

The engine provides:

- visual score calculation;
- Shapiro-Wilk by treatment when at least three replicates are available;
- one-way ANOVA when every treatment has at least two replicates;
- Tukey HSD after a significant ANOVA;
- linear regression and Pearson correlation for numeric concentrations;
- Pearson-test power using the noncentral t distribution;
- score and class-distribution charts aggregated by replicate.

Undefined analyses return an explicit `performed: false` result and reason.
JSON serialization rejects non-finite values, and small p-values retain their
numeric precision while the UI formats them as inequalities.

## Independent Validation

`tests/reference/v1/` contains a versioned dataset and expected results. The
Python engine is tested against those values, and
`npm run test:reference:r` runs the same dataset through base R to compare
Shapiro-Wilk, ANOVA, Tukey, regression and Pearson results. R is never loaded
by the browser application.

Playwright also runs the extracted Python engine inside real Pyodide and checks
the rendered reference results and generated charts.

## Deployment And Offline Behavior

The project can be deployed to any HTTPS static host. Keep the existing paths
relative to the repository root and update `CACHE_NAME` in `service-worker.js`
when cached resources change.

The local application shell and Python analysis source are cached. Pyodide,
NumPy, SciPy and Matplotlib are still loaded from the configured CDN, so the
first statistical analysis requires network access. Counting and previously
cached application resources can continue without the statistical runtime.

## Known Limitations

- `localStorage` remains the only live persistence layer and is not encrypted.
- Encrypted backup protects the exported file, not a device user with access to browser storage or developer tools.
- Pyodide and scientific packages are not yet hosted locally.
- Merge rejects active partial progress instead of reconciling concurrent counts.
- Browser automation currently targets Chromium with Pixel 7 emulation.
- The comet class illustrations are provisional.
