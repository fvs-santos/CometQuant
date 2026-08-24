# CometQuant Lab

Mobile-first PWA for blinded visual scoring and statistical analysis of comet
assay experiments. All experiment data remains in the browser; the application
has no backend or remote database.

## Requirements

- Node.js 20 or newer for development and automated tests.
- Python 3.12 with `requirements-test.txt` for statistical engine tests.
- R 4 or newer only for the optional independent statistical audit.
- Chromium and WebKit installed by Playwright for browser tests.

## Development

```powershell
npm ci
npx playwright install chromium webkit
python -m pip install -r requirements-test.txt
npm run check
npm test
npm run test:analysis
npm run test:reference:r
npm run test:e2e
```

Use `npm run test:e2e:chromium` or `npm run test:e2e:webkit` to run one browser
project. The WebKit project emulates an iPhone but does not replace validation
on Safari and real iOS hardware.

`npm ci` copies JSZip to `vendor/` so ZIP exports work in static deployments.
Use `npx http-server . -p 4173 -c-1` to run the application locally.

## Architecture

- `index.html` and `css/style.css`: static application shell and responsive UI.
- `js/app.js`: navigation, blinded counting and transactional local persistence.
- `js/legacy-xlsx.js`: constrained offline importer for legacy Comet VisualScore workbooks.
- `js/backup.js`: password-based encrypted backup envelopes for active blinding.
- `js/core.js`: schema migration, validation, scoring, aggregation and merge.
- `js/analysis.js`: Pyodide bridge, result rendering and analysis exports.
- `js/science-package.js`: verified scientific package installation and storage diagnostics.
- `python/cometquant_analysis.py`: statistical engine used by both Pyodide and Python tests.
- `js/export.js`: safe JSON, CSV, HTML and ZIP builders.
- `service-worker.js`: application-shell cache for the PWA.

Scripts are loaded as classic browser scripts, so their order in `index.html`
is significant.

## Data And Blinding

The current experiment schema is version 6. Each replicate contains a complete
mapping of blind assignments and counted slides. Assignment states are
`pending`, `counting`, `counted` or `absent`.

New experiments record a versioned study design before blind codes are generated.
The design identifies genotoxicity or antigenotoxicity, the primary reference,
the test concentrations, the separate control-response comparison and structured
numeric concentration metadata. Genotoxicity compares concentrations with the
selected negative or vehicle control. Antigenotoxicity compares combined
treatments with the positive mutagen-only control. The design is not shown while
counting is blinded.

After blinding is complete, a counted or absent slide can be corrected from the
experiment summary. Every correction requires a responsible person's name and a
free-text reason. The application saves the previous and corrected terminal
states in an append-only `slideEditHistory` event in the same IndexedDB
transaction. Current `gels` and `assignments` remain the only scientific input;
the history is exported separately in HTML and `slide_corrections.csv` and is
included in JSON, encrypted backups and ZIP packages.

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
before normal schema validation. Experiments from schemas 1 through 5 migrate
without an inferred scientific intent and require one explicit study-design
confirmation after blinding is complete before the new analysis can run.

The encrypted envelope protects a copied backup file against offline inspection
when a strong passphrase is used. It does not protect against someone with
access to the unlocked browser profile, malicious extensions, screen capture or
code executing in the application origin. The externally loaded Pyodide runtime
is therefore part of the trusted computing base and should be hosted locally
before handling data with stricter confidentiality requirements.

## Statistical Protocol

An independent experiment is the experimental unit and statistical block.
Counted technical slides with a positive, internally consistent class total are
scored using that effective total and averaged within each experiment and
treatment. A count above or below the collection target remains analyzable and
is reported as off-target. One valid slide keeps the cell in the analysis while
the technical loss is reported. If no valid slide exists for the primary reference or any primary
concentration, that complete block is explicitly excluded from primary
inference.

The version 2 analysis contract provides:

- randomized complete block ANOVA using `score ~ treatment + experiment`;
- visual scores divided by the effective positive class-count total for each slide, with off-target slides retained and flagged;
- planned two-sided comparisons of each concentration against the configured reference;
- a common residual error estimate and Holm-adjusted p-values without an omnibus gate;
- nominal 95% confidence intervals, effect direction and unrounded decisions;
- a separate blocked control-response comparison that does not classify assay validity;
- a secondary linear dose trend using `score ~ experiment + concentration`, with the reference as dose zero;
- individual block profiles, difference confidence intervals and descriptive class charts;
- per-treatment dispersion (mean, SD, CV) with a variance-heterogeneity flag;
- an exact non-parametric sensitivity block (Friedman omnibus and Page L ordered trend by permutation), with Page's direction derived from the assay type;
- an arcsine-sqrt transformed sensitivity re-run of the block ANOVA, comparisons and dose trend.

Shapiro-Wilk no longer selects the method. One-way ANOVA, Tukey HSD, pooled
Pearson correlation and the former power calculation are not part of the v2
runtime contract. The non-parametric and transformed blocks are robustness
checks that confirm consistency; they are not a second attempt at significance.
The planned comparisons remain parametric because exact paired inference (e.g.
Wilcoxon) has very limited resolution with the common design of three
independent experiments.

Undefined analyses return an explicit `performed: false` result and structured
reason. JSON serialization rejects non-finite values, and small p-values retain
their numeric precision while the UI formats them only for presentation. The
application reports statistical evidence and magnitude; it does not automatically
classify a compound as genotoxic, non-genotoxic or antigenotoxic.

## Independent Validation

`tests/reference/v2/` contains three independent experiments, five treatments
and two technical slides per cell, including a cell retained with one valid
slide. Explicit SciPy formulas and base R independently validate the block
ANOVA, planned contrasts, Holm adjustment, confidence intervals, control
response, dose trend, exact Friedman/Page permutations, and the arcsine-sqrt
transformed analysis. `tests/reference/v1/` remains immutable historical
evidence for the retired protocol. R is never loaded by the browser application.

Playwright also runs the extracted Python engine inside real Pyodide and checks
the rendered v2 reference results and three generated charts.

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

The Storage Diagnostics screen reports API availability, estimated usage and
quota, persistent-storage state, offline shell state and scientific package
status. These values are technical estimates and the report contains no
experiment contents or experiment counts. It does include a timestamp, browser
user agent and platform string for troubleshooting. Real-device validation follows
`docs/safari-ios-storage-checklist.md`.

Chromium automation performs a fully offline reload. Playwright WebKit verifies
cache completeness and runtime reuse after reload; true offline process restart
and storage eviction remain part of the real-device checklist.

## Known Limitations

- IndexedDB data at rest is not encrypted and remains accessible to a user with browser or device access.
- Encrypted backup protects the exported file, not a device user with access to browser storage or developer tools.
- Merge rejects active partial progress instead of reconciling concurrent counts.
- Browser automation covers Chromium/Pixel 7 and Playwright WebKit/iPhone emulation; Safari/iOS support still requires the real-device checklist.
- The comet class illustrations are provisional.
- Three independent experiments are supported as the common assay design, but estimates and confidence intervals may remain imprecise; statistical non-significance is not evidence of equivalence or absence of effect.
- The blocked model assumes additive block effects (no treatment-by-experiment interaction), which is undiagnosable with a single replication per cell; this assumption is declared rather than testable.
- The two-treatment validation block model estimates its residual with few degrees of freedom; the separate model is kept intentionally rather than pooling error with the primary population.
