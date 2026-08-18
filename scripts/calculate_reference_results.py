"""Calculate versioned SciPy oracles without importing the application engine."""

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import scipy
from scipy import stats


ROOT = Path(__file__).resolve().parents[1]


def rounded(value, digits=5):
    return round(float(value), digits)


def calculate_v1():
    dataset = ROOT / "tests" / "reference" / "v1" / "slides.csv"
    replicate_slides = defaultdict(list)
    concentrations = {}
    controls = set()
    with dataset.open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            key = (int(row["replicate"]), row["treatment"])
            replicate_slides[key].append(float(row["score"]))
            if row["concentration"]:
                concentrations[row["treatment"]] = float(row["concentration"])
            if row["is_control"] == "true":
                controls.add(row["treatment"])

    treatment_order = ["Control", "1 uM", "5 uM", "10 uM"]
    scores = {
        treatment: [
            float(np.mean(replicate_slides[(replicate, treatment)]))
            for replicate in range(1, 6)
        ]
        for treatment in treatment_order
    }
    shapiro = {}
    for treatment, values in scores.items():
        result = stats.shapiro(values)
        shapiro[treatment] = {"W": rounded(result.statistic), "p": float(result.pvalue)}

    groups = [scores[treatment] for treatment in treatment_order]
    anova_result = stats.f_oneway(*groups)
    all_values = np.concatenate(groups)
    grand_mean = float(np.mean(all_values))
    ss_between = sum(
        len(group) * (float(np.mean(group)) - grand_mean) ** 2 for group in groups
    )
    df_between = len(groups) - 1
    tukey_result = stats.tukey_hsd(*groups)
    tukey = []
    for first in range(len(treatment_order)):
        for second in range(first + 1, len(treatment_order)):
            tukey.append(
                {
                    "A": treatment_order[first],
                    "B": treatment_order[second],
                    "p": float(tukey_result.pvalue[first][second]),
                }
            )

    x_values = []
    y_values = []
    for treatment in treatment_order:
        if treatment in controls:
            continue
        x_values.extend([concentrations[treatment]] * len(scores[treatment]))
        y_values.extend(scores[treatment])
    regression = stats.linregress(x_values, y_values)
    pearson = stats.pearsonr(x_values, y_values)
    degrees_freedom = len(x_values) - 2
    t_critical = stats.t.ppf(0.975, degrees_freedom)
    noncentrality = abs(pearson.statistic) * math.sqrt(
        degrees_freedom / (1 - pearson.statistic**2)
    )
    critical = stats.t.ppf(0.975, degrees_freedom)
    power = stats.nct.cdf(-critical, degrees_freedom, noncentrality) + stats.nct.sf(
        critical, degrees_freedom, noncentrality
    )
    return {
        "provenance": {
            "method": "Independent SciPy calls plus explicit sums-of-squares formulas",
            "scipy": scipy.__version__,
            "dataset": "slides.csv",
        },
        "scores": scores,
        "shapiro": shapiro,
        "anova": {
            "F": rounded(anova_result.statistic),
            "p": float(anova_result.pvalue),
            "SS": rounded(ss_between),
            "MS": rounded(ss_between / df_between),
            "DF": df_between,
        },
        "tukey": tukey,
        "regression": {
            "slope": rounded(regression.slope),
            "intercept": rounded(regression.intercept),
            "r2": rounded(regression.rvalue**2),
            "p": float(regression.pvalue),
            "ci_low": rounded(regression.slope - t_critical * regression.stderr),
            "ci_high": rounded(regression.slope + t_critical * regression.stderr),
        },
        "pearson": {
            "r": rounded(pearson.statistic),
            "p": float(pearson.pvalue),
            "power": rounded(power, 3),
        },
    }


def rcbd(values, treatment_indices):
    block_count, treatment_count = values.shape
    grand_mean = float(np.mean(values))
    total_ss = float(np.sum((values - grand_mean) ** 2))
    treatment_ss = float(
        block_count * np.sum((np.mean(values, axis=0) - grand_mean) ** 2)
    )
    block_ss = float(
        treatment_count * np.sum((np.mean(values, axis=1) - grand_mean) ** 2)
    )
    residual_ss = total_ss - treatment_ss - block_ss
    treatment_df = treatment_count - 1
    block_df = block_count - 1
    residual_df = treatment_df * block_df
    mse = residual_ss / residual_df
    treatment_ms = treatment_ss / treatment_df
    block_ms = block_ss / block_df
    treatment_f = treatment_ms / mse
    block_f = block_ms / mse
    return {
        "model": "score ~ treatment + block",
        "blockCount": block_count,
        "treatmentIndices": treatment_indices,
        "residualDF": residual_df,
        "MSE": mse,
        "terms": [
            {
                "term": "treatment",
                "SS": treatment_ss,
                "DF": treatment_df,
                "MS": treatment_ms,
                "F": treatment_f,
                "p": float(stats.f.sf(treatment_f, treatment_df, residual_df)),
            },
            {
                "term": "block",
                "SS": block_ss,
                "DF": block_df,
                "MS": block_ms,
                "F": block_f,
                "p": float(stats.f.sf(block_f, block_df, residual_df)),
            },
            {"term": "residual", "SS": residual_ss, "DF": residual_df, "MS": mse},
        ],
    }


def holm(p_values):
    order = sorted(range(len(p_values)), key=p_values.__getitem__)
    adjusted = [0.0] * len(p_values)
    maximum = 0.0
    for rank, index in enumerate(order):
        maximum = max(maximum, (len(p_values) - rank) * p_values[index])
        adjusted[index] = min(1.0, maximum)
    return adjusted


def contrast(reference, treatment, mse, residual_df):
    difference = float(np.mean(treatment) - np.mean(reference))
    standard_error = math.sqrt(mse * (1 / len(reference) + 1 / len(treatment)))
    statistic = difference / standard_error
    critical = float(stats.t.ppf(0.975, residual_df))
    return {
        "referenceMean": float(np.mean(reference)),
        "treatmentMean": float(np.mean(treatment)),
        "difference": difference,
        "standardError": standard_error,
        "t": statistic,
        "DF": residual_df,
        "ciLow": difference - critical * standard_error,
        "ciHigh": difference + critical * standard_error,
        "pRaw": float(2 * stats.t.sf(abs(statistic), residual_df)),
    }


def calculate_v2():
    dataset = ROOT / "tests" / "reference" / "v2" / "slides.csv"
    slides = []
    with dataset.open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            row["replicate_number"] = int(row["replicate_number"])
            row["treatment_index"] = int(row["treatment_index"])
            row["score"] = float(row["score"])
            slides.append(row)

    grouped = defaultdict(list)
    labels = {}
    for row in slides:
        labels[row["treatment_index"]] = row["treatment"]
        if row["status"] == "counted" and row["completion"] == "complete":
            grouped[(row["replicate_number"], row["treatment_index"])].append(row["score"])
    cells = {key: float(np.mean(values)) for key, values in grouped.items()}
    blocks = sorted({row["replicate_number"] for row in slides})
    primary_indices = [0, 2, 3, 4]
    complete_blocks = [
        block for block in blocks if all((block, index) in cells for index in primary_indices)
    ]
    values = np.asarray(
        [[cells[(block, index)] for index in primary_indices] for block in complete_blocks]
    )
    anova = rcbd(values, primary_indices)

    comparisons = []
    for column, treatment_index in enumerate(primary_indices[1:], start=1):
        result = contrast(values[:, 0], values[:, column], anova["MSE"], anova["residualDF"])
        result["treatmentIndex"] = treatment_index
        comparisons.append(result)
    adjusted = holm([item["pRaw"] for item in comparisons])
    for item, p_adjusted in zip(comparisons, adjusted):
        item["pAdjusted"] = p_adjusted

    validation_indices = [0, 1]
    validation_blocks = [
        block for block in blocks if all((block, index) in cells for index in validation_indices)
    ]
    validation_values = np.asarray(
        [[cells[(block, index)] for index in validation_indices] for block in validation_blocks]
    )
    validation_anova = rcbd(validation_values, validation_indices)
    validation_comparison = contrast(
        validation_values[:, 0],
        validation_values[:, 1],
        validation_anova["MSE"],
        validation_anova["residualDF"],
    )

    doses = np.asarray([0.0, 1.0, 5.0, 10.0])
    y = values.reshape(-1)
    block_ids = np.repeat(np.arange(len(complete_blocks)), len(primary_indices))
    design = np.column_stack(
        [np.ones(y.size)]
        + [(block_ids == index).astype(float) for index in range(1, len(complete_blocks))]
        + [np.tile(doses, len(complete_blocks))]
    )
    coefficients = np.linalg.solve(design.T @ design, design.T @ y)
    residuals = y - design @ coefficients
    trend_df = y.size - design.shape[1]
    trend_mse = float(residuals @ residuals / trend_df)
    covariance = trend_mse * np.linalg.inv(design.T @ design)
    slope = float(coefficients[-1])
    slope_se = math.sqrt(covariance[-1, -1])
    slope_t = slope / slope_se
    slope_critical = float(stats.t.ppf(0.975, trend_df))
    trend_ss_total = float(np.sum((y - np.mean(y)) ** 2))

    return {
        "provenance": {
            "method": "Independent SciPy distributions, explicit RCBD sums of squares, contrasts, Holm, and matrix OLS",
            "scipy": scipy.__version__,
            "dataset": "slides.csv",
        },
        "fixture": {
            "independentExperiments": len(blocks),
            "slides": len(slides),
            "invalidTechnicalSlides": sum(
                row["status"] != "counted" or row["completion"] != "complete"
                for row in slides
            ),
            "primaryIncludedBlockNumbers": complete_blocks,
        },
        "scores": {
            labels[index]: [cells[(block, index)] for block in blocks if (block, index) in cells]
            for index in sorted(labels)
        },
        "blockAnova": anova,
        "primaryComparisons": comparisons,
        "controlResponse": {
            "blockNumbers": validation_blocks,
            "blockAnova": validation_anova,
            "comparison": validation_comparison,
        },
        "doseTrend": {
            "slope": slope,
            "standardError": slope_se,
            "t": slope_t,
            "DF": trend_df,
            "MSE": trend_mse,
            "ciLow": slope - slope_critical * slope_se,
            "ciHigh": slope + slope_critical * slope_se,
            "p": float(2 * stats.t.sf(abs(slope_t), trend_df)),
            "r2": 1 - float(residuals @ residuals) / trend_ss_total,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=("v1", "v2"), default="v2")
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    result = calculate_v1() if arguments.version == "v1" else calculate_v2()
    serialized = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if arguments.output:
        arguments.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")


if __name__ == "__main__":
    main()
