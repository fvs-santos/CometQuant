"""Run the independent R reference and compare it with the versioned fixture."""

import csv
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "tests" / "reference" / "v1"


def find_rscript():
    configured = os.environ.get("RSCRIPT")
    if configured and Path(configured).is_file():
        return configured
    available = shutil.which("Rscript")
    if available:
        return available
    candidates = sorted(Path("C:/Program Files/R").glob("R-*/bin/Rscript.exe"), reverse=True)
    if candidates:
        return str(candidates[0])
    raise SystemExit("Rscript was not found. Install R or set the RSCRIPT environment variable.")


def expected_metrics(expected):
    metrics = {}
    for treatment, result in expected["shapiro"].items():
        metrics[f"shapiro::{treatment}::W"] = result["W"]
        metrics[f"shapiro::{treatment}::p"] = result["p"]
    for field, value in expected["anova"].items():
        metrics[f"anova::{field}"] = value
    for comparison in expected["tukey"]:
        metrics[f"tukey::{comparison['A']}::{comparison['B']}::p"] = comparison["p"]
    for field, value in expected["regression"].items():
        metrics[f"regression::{field}"] = value
    for field, value in expected["pearson"].items():
        metrics[f"pearson::{field}"] = value
    return metrics


def main():
    expected = json.loads((REFERENCE / "expected.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "r-results.csv"
        subprocess.run(
            [
                find_rscript(),
                str(REFERENCE / "reference_analysis.R"),
                str(REFERENCE / "slides.csv"),
                str(output),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        with output.open(encoding="utf-8", newline="") as source:
            actual = {row["metric"]: float(row["value"]) for row in csv.DictReader(source)}

    expected_values = expected_metrics(expected)
    missing = sorted(set(expected_values) - set(actual))
    unexpected = sorted(set(actual) - set(expected_values))
    if missing or unexpected:
        raise SystemExit(f"Reference metric mismatch. Missing: {missing}; unexpected: {unexpected}")

    failures = []
    for metric, expected_value in expected_values.items():
        if metric.endswith("::p"):
            reported_actual = actual[metric]
            if expected_value > 0 and reported_actual <= 0:
                matches = False
            elif expected_value < 1e-8:
                matches = abs(math.log10(reported_actual) - math.log10(expected_value)) <= 2
            else:
                matches = math.isclose(reported_actual, expected_value, rel_tol=1e-3, abs_tol=0)
        else:
            reported_actual = round(actual[metric], 3 if metric == "pearson::power" else 5)
            matches = math.isclose(reported_actual, expected_value, rel_tol=0, abs_tol=1e-5)
        if not matches:
            failures.append(f"{metric}: R={reported_actual}, expected={expected_value}")
    if failures:
        raise SystemExit("R reference differs from expected.json:\n" + "\n".join(failures))

    print(f"R reference validated: {len(expected_values)} metrics match expected.json")


if __name__ == "__main__":
    main()
