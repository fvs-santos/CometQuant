# Safari, iOS And Storage Validation Checklist

Playwright WebKit is an automated compatibility signal. It does not reproduce
Safari storage eviction, iOS process termination, installed PWA lifecycle,
Files integration or physical device memory limits. Complete this checklist on
real Apple hardware before declaring Safari or iOS support.

## Test Matrix

Record one result for each environment:

| Environment | Required |
| --- | --- |
| Safari on macOS | Yes |
| Safari tab on iPhone | Yes |
| Installed PWA on iPhone | Yes |
| Safari tab or installed PWA on iPad | Yes |
| iPhone or iPad with low free storage | Yes |

Test the current stable Safari/iOS release and the oldest release the project
intends to support.

## Environment Record

- Date:
- Tester:
- Commit:
- Deployment URL:
- Device model:
- OS version:
- Safari version:
- Browser tab or installed PWA:
- Device free storage before test:
- Network conditions:
- Diagnostic report filename:

Do not include experiment names, treatment mappings or scientific data in issue
reports. Attach the technical JSON report from Storage Diagnostics when useful.

## Preparation

1. Deploy the exact commit to HTTPS.
2. Open the application online and wait for the service worker to activate.
3. Open Storage Diagnostics and download the baseline report.
4. Create an encrypted backup before storage-pressure tests.
5. Keep Safari Web Inspector connected when investigating a failure.

## Core Counting

| ID | Procedure | Acceptance criterion |
| --- | --- | --- |
| CORE-01 | Create an experiment and generate blind codes. | Codes and labels render without clipping. |
| CORE-02 | Count several classes, undo and reload. | Every accepted operation is restored exactly. |
| CORE-03 | Background the app during counting, wait five minutes and resume. | The current slide and counts remain intact. |
| CORE-04 | Lock the device during counting and resume. | No duplicate or lost count is observed. |
| CORE-05 | Kill Safari or the installed PWA and reopen it. | The last committed count is restored. |
| CORE-06 | Complete, justify an incomplete slide and register an absent slide. | Required reasons and blinding gates remain enforced. |

## Offline And PWA Lifecycle

| ID | Procedure | Acceptance criterion |
| --- | --- | --- |
| PWA-01 | Add the application to the Home Screen and launch it. | Standalone mode opens and fits safe areas. |
| PWA-02 | Enable airplane mode and reopen the installed PWA. | Home, experiment list and counting load offline. |
| PWA-03 | Close the process while offline and reopen it. | The shell and committed experiment remain available. |
| PWA-04 | Deploy a new shell cache version and reopen online. | The update activates without deleting experiments or the scientific package. |
| PWA-05 | Open inputs with the software keyboard visible. | Headers, buttons and active fields remain reachable. |

## Storage And Quota

| ID | Procedure | Acceptance criterion |
| --- | --- | --- |
| STORE-01 | Download a diagnostic report before scientific package installation. | Usage, quota and persistence are reported or explicitly unknown. |
| STORE-02 | Prepare the scientific package and run diagnostics again. | Usage increases and package status becomes installed. |
| STORE-03 | Repeat STORE-02 with low device free storage. | Installation succeeds or fails clearly without affecting experiments. |
| STORE-04 | Interrupt package download by closing the app or disabling the network. | A retry succeeds and no partial package is reported as installed. |
| STORE-05 | Fill storage until a count write fails. | The previous committed count remains authoritative and retry is possible. |
| STORE-06 | Clear website cache while retaining website data when the OS permits it. | Missing scientific assets do not remove IndexedDB experiments. |
| STORE-07 | Reopen after 24 hours and again after seven days. | Any eviction is detected and documented; backup recovery remains possible. |

Quota values are estimates and must not be treated as guaranteed capacity.
IndexedDB and Cache Storage share origin storage and may be evicted by the OS.

## Scientific Runtime

| ID | Procedure | Acceptance criterion |
| --- | --- | --- |
| SCI-01 | Prepare the pinned Pyodide package online. | Download, integrity verification and cache installation complete. |
| SCI-02 | Run the reference analysis. | Tables and charts render without worker or memory errors. |
| SCI-03 | Reload fully offline and run the analysis again. | The cached runtime executes without network access. |
| SCI-04 | Background the app during analysis and resume. | Cancellation or recovery is explicit; no experiment data changes. |
| SCI-05 | Repeat on the lowest-memory supported device. | The process is not terminated, or the limitation is documented. |

## Backup And Files

| ID | Procedure | Acceptance criterion |
| --- | --- | --- |
| FILE-01 | Export an encrypted blinded backup. | Safari or the installed PWA offers a usable file download/share flow. |
| FILE-02 | Restore the exported file through Files. | The password prompt and validated restoration complete. |
| FILE-03 | Export CSV, HTML and ZIP after blinding is complete. | Files open with expected names and contents. |
| FILE-04 | Cancel a file picker or share sheet. | The application remains usable without stale state. |

## Final Decision

Record one outcome:

- Supported: all blocking criteria passed on the declared version range.
- Supported with limitations: limitations are documented in README and UI.
- Not supported: a blocking data integrity, offline or runtime failure remains.

Automated WebKit success alone must be reported as "tested with Playwright
WebKit", not "Safari/iOS supported".
