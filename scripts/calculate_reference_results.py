"""Calculate the v1 reference fixture without importing the app engine."""

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import scipy
from scipy import stats


ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "tests" / "reference" / "v1" / "slides.csv"


def rounded(value, digits=5):
    return round(float(value), digits)


replicate_slides = defaultdict(list)
concentrations = {}
controls = set()
with DATASET.open(encoding="utf-8", newline="") as source:
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
t_critical = stats.t.ppf(0.975, len(x_values) - 2)
degrees_freedom = len(x_values) - 2
noncentrality = abs(pearson.statistic) * math.sqrt(degrees_freedom / (1 - pearson.statistic**2))
critical = stats.t.ppf(0.975, degrees_freedom)
power = stats.nct.cdf(-critical, degrees_freedom, noncentrality) + stats.nct.sf(critical, degrees_freedom, noncentrality)

reference = {
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

print(json.dumps(reference, indent=2, allow_nan=False))
