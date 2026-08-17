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

The current experiment schema is version 4. Each replicate contains a complete
mapping of blind assignments and counted slides. Assignment states are
`pending`, `counting`, `counted` or `absent`.

New blind codes use two ordered letters and an unpadded slide number, such as
`AB1`, `AB2` or `CY10`. The 676 bases from `AA` through `ZZ` are allocated
without reuse across the whole experiment. Legacy codes such as `ABCD-01`
remain valid and are preserved unchanged during migration and import.

Counts are committed atomically to IndexedDB after every increment and undo.
Terminal operations only advance the interface after a successful validated
write. Unknown, future-version and malformed legacy entries are quarantined
and remain available through the storage recovery export.

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
relative to the repository root and update the shell cache version in
`service-worker.js` when cached resources change.

The application shell never downloads Pyodide during startup. Statistical
analysis is an optional package prepared by explicit user action. Its pinned
assets are downloaded from jsDelivr, verified with SHA-256 and stored in a
separate Cache Storage namespace. The transfer is about 35.7 MB and the
verified content occupies about 104.4 MB; 120-150 MB of free origin storage is
recommended. Once prepared, the analysis worker and all scientific packages
run after a fully offline reload. Counting remains available without the
scientific package.

Experiments are stored atomically in IndexedDB with monotonic revisions.
Existing `localStorage` data is copied on first use, and malformed, duplicate
or future-version records are retained in quarantine. When quarantine data is
present, the experiments screen offers a recovery export. Encrypted backups
remain the durable transfer and disaster-recovery mechanism.

## Known Limitations

- IndexedDB data at rest is not encrypted and remains accessible to a user with browser or device access.
- Encrypted backup protects the exported file, not a device user with access to browser storage or developer tools.
- Merge rejects active partial progress instead of reconciling concurrent counts.
- Browser automation currently targets Chromium with Pixel 7 emulation.
- The comet class illustrations are provisional.
