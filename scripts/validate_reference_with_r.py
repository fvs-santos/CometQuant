"""Run an independent R reference and compare it with a versioned fixture."""

import argparse
import csv
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


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


def expected_v1_metrics(expected):
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


def expected_v2_metrics(expected):
    metrics = {}
    for term in expected["blockAnova"]["terms"]:
        for field in ("SS", "DF", "MS", "F", "p"):
            if field in term:
                metrics[f"blockAnova::{term['term']}::{field}"] = term[field]
    field_names = {
        "referenceMean": "reference_mean",
        "treatmentMean": "treatment_mean",
        "difference": "difference",
        "standardError": "standard_error",
        "t": "t",
        "DF": "DF",
        "ciLow": "ci_low",
        "ciHigh": "ci_high",
        "pRaw": "p_raw",
        "pAdjusted": "p_adjusted",
    }
    for comparison in expected["primaryComparisons"]:
        treatment_index = comparison["treatmentIndex"]
        for source, target in field_names.items():
            metrics[f"primaryComparison::{treatment_index}::{target}"] = comparison[source]

    control = expected["controlResponse"]
    metrics["controlResponse::MSE"] = control["blockAnova"]["MSE"]
    metrics["controlResponse::DF"] = control["blockAnova"]["residualDF"]
    control_fields = {
        "difference": "difference",
        "standardError": "standard_error",
        "t": "t",
        "ciLow": "ci_low",
        "ciHigh": "ci_high",
        "pRaw": "p",
    }
    for source, target in control_fields.items():
        metrics[f"controlResponse::{target}"] = control["comparison"][source]

    trend_fields = {
        "slope": "slope",
        "standardError": "standard_error",
        "t": "t",
        "DF": "DF",
        "MSE": "MSE",
        "ciLow": "ci_low",
        "ciHigh": "ci_high",
        "p": "p",
        "r2": "r2",
        "r2Partial": "r2_partial",
    }
    for source, target in trend_fields.items():
        metrics[f"doseTrend::{target}"] = expected["doseTrend"][source]

    non_parametric = expected["nonParametric"]
    friedman = non_parametric["friedman"]
    metrics["nonParametric::friedman::Q"] = friedman["statistic"]
    metrics["nonParametric::friedman::df"] = friedman["df"]
    metrics["nonParametric::friedman::pExact"] = friedman["pExact"]
    metrics["nonParametric::friedman::exactArrangements"] = friedman["exactArrangements"]
    page = non_parametric["pageTrend"]
    metrics["nonParametric::page::L"] = page["statistic"]
    metrics["nonParametric::page::pExact"] = page["pExact"]
    metrics["nonParametric::page::pExactOpposite"] = page["pExactOpposite"]

    transformed = expected["transformedAnalysis"]
    for term in transformed["blockAnova"]["terms"]:
        for field in ("SS", "DF", "MS", "F", "p"):
            if field in term:
                metrics[f"transformed::blockAnova::{term['term']}::{field}"] = term[field]
    for comparison in transformed["primaryComparisons"]:
        treatment_index = comparison["treatmentIndex"]
        metrics[f"transformed::comparison::{treatment_index}::difference"] = comparison["difference"]
        metrics[f"transformed::comparison::{treatment_index}::p"] = comparison["pRaw"]
        metrics[f"transformed::comparison::{treatment_index}::p_adjusted"] = comparison["pAdjusted"]
    metrics["transformed::trend::slope"] = transformed["doseTrend"]["slope"]
    metrics["transformed::trend::p"] = transformed["doseTrend"]["p"]
    return metrics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=("v1", "v2"), default="v2")
    arguments = parser.parse_args()
    reference = ROOT / "tests" / "reference" / arguments.version
    expected = json.loads((reference / "expected.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as temporary_directory:
        output = Path(temporary_directory) / "r-results.csv"
        subprocess.run(
            [
                find_rscript(),
                str(reference / "reference_analysis.R"),
                str(reference / "slides.csv"),
                str(output),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        with output.open(encoding="utf-8", newline="") as source:
            actual = {row["metric"]: float(row["value"]) for row in csv.DictReader(source)}

    expected_values = (
        expected_v1_metrics(expected)
        if arguments.version == "v1"
        else expected_v2_metrics(expected)
    )
    missing = sorted(set(expected_values) - set(actual))
    unexpected = sorted(set(actual) - set(expected_values))
    if missing or unexpected:
        raise SystemExit(f"Reference metric mismatch. Missing: {missing}; unexpected: {unexpected}")

    failures = []
    for metric, expected_value in expected_values.items():
        if metric.endswith("::p") or metric.endswith("::p_raw") or metric.endswith("::p_adjusted"):
            reported_actual = actual[metric]
            if arguments.version == "v2":
                matches = expected_value > 0 and reported_actual > 0 and math.isclose(
                    reported_actual, expected_value, rel_tol=1e-7, abs_tol=0
                )
            elif expected_value > 0 and reported_actual <= 0:
                matches = False
            elif expected_value < 1e-8:
                matches = abs(math.log10(reported_actual) - math.log10(expected_value)) <= 2
            else:
                matches = math.isclose(reported_actual, expected_value, rel_tol=1e-3, abs_tol=0)
        else:
            reported_actual = actual[metric]
            tolerance = 1e-5 if arguments.version == "v1" else 1e-8
            matches = math.isclose(reported_actual, expected_value, rel_tol=1e-8, abs_tol=tolerance)
        if not matches:
            failures.append(f"{metric}: R={reported_actual}, expected={expected_value}")
    if failures:
        raise SystemExit("R reference differs from expected.json:\n" + "\n".join(failures))

    print(
        f"R reference {arguments.version} validated: "
        f"{len(expected_values)} metrics match expected.json"
    )


if __name__ == "__main__":
    main()
