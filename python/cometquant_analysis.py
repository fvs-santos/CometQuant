"""Statistical analysis engine used directly by CometQuant's Pyodide runtime."""

import base64
import io
import itertools
import json
import math
from collections import Counter

import matplotlib
import numpy as np
from scipy import stats

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def _reason(code, detail):
    return {
        "performed": False,
        "reason": {"code": code, "detail": detail},
    }


def _clean_scores(values):
    clean = []
    for value in values:
        if value is None:
            continue
        numeric = float(value)
        if np.isfinite(numeric):
            clean.append(numeric)
    return clean


def _rounded(value, digits=5):
    return round(_finite(value), digits)


def _finite(value):
    numeric = float(value)
    if not np.isfinite(numeric):
        raise ValueError("Statistical calculation produced a non-finite value")
    return numeric


def _probability(value):
    probability = _finite(value)
    if probability < 0 or probability > 1:
        raise ValueError("Statistical calculation produced an invalid probability")
    return float(np.nextafter(0, 1)) if probability == 0 else probability


def _correlation_power(correlation, observation_count, alpha=0.05):
    correlation = abs(_finite(correlation))
    if correlation >= 1:
        return 1.0
    degrees_freedom = observation_count - 2
    noncentrality = correlation * np.sqrt(degrees_freedom / (1 - correlation**2))
    critical = stats.t.ppf(1 - alpha / 2, degrees_freedom)
    return _finite(
        stats.nct.cdf(-critical, degrees_freedom, noncentrality)
        + stats.nct.sf(critical, degrees_freedom, noncentrality)
    )


def calculate_scores(experiment):
    """Average technical slides within each biological replicate."""
    nucleoids = float(experiment["nucleoidsPerGel"])
    if not np.isfinite(nucleoids) or nucleoids <= 0:
        raise ValueError("nucleoidsPerGel must be a positive finite number")

    treatments = experiment["treatments"]
    scores_by_treatment = {treatment: [] for treatment in treatments}

    for replicate in experiment["replicates"]:
        replicate_scores = {treatment: [] for treatment in treatments}
        for gel in replicate["gels"]:
            if (
                gel.get("status", "counted") != "counted"
                or gel.get("completion", "complete") != "complete"
            ):
                continue
            score = (
                0.25 * float(gel["class1"])
                + 0.50 * float(gel["class2"])
                + 0.75 * float(gel["class3"])
                + float(gel["class4"])
            ) / nucleoids * 100
            treatment = gel["treatment"]
            if treatment in replicate_scores and np.isfinite(score):
                replicate_scores[treatment].append(score)

        for treatment, slide_scores in replicate_scores.items():
            if slide_scores:
                scores_by_treatment[treatment].append(float(np.mean(slide_scores)))

    return scores_by_treatment


def calculate_shapiro(scores_by_treatment):
    results = {}
    for treatment, scores in scores_by_treatment.items():
        clean = _clean_scores(scores)
        if len(clean) < 3:
            results[treatment] = _reason(
                "insufficient_observations",
                f"Shapiro-Wilk requires at least 3 observations; received {len(clean)}.",
            )
            continue
        if np.ptp(clean) == 0:
            results[treatment] = _reason(
                "zero_variance",
                "Shapiro-Wilk is not informative when all observations are equal.",
            )
            continue

        statistic, p_value = stats.shapiro(clean)
        results[treatment] = {
            "performed": True,
            "W": _rounded(statistic),
            "p": _probability(p_value),
            "normal": bool(p_value > 0.05),
        }
    return results


def calculate_anova(scores_by_treatment):
    if len(scores_by_treatment) < 2:
        return _reason(
            "insufficient_groups",
            "One-way ANOVA requires at least 2 treatments.",
        )

    groups = []
    insufficient = []
    for treatment, scores in scores_by_treatment.items():
        clean = _clean_scores(scores)
        if len(clean) < 2:
            insufficient.append(f"{treatment} (n={len(clean)})")
        groups.append(clean)

    if insufficient:
        return _reason(
            "insufficient_repetitions",
            "Every treatment must have at least 2 repetitions; insufficient: "
            + ", ".join(insufficient)
            + ".",
        )

    all_values = np.concatenate([np.asarray(group, dtype=float) for group in groups])
    grand_mean = float(np.mean(all_values))
    group_means = [float(np.mean(group)) for group in groups]
    sample_count = len(all_values)
    group_count = len(groups)
    df_between = group_count - 1
    df_within = sample_count - group_count
    ss_between = sum(
        len(group) * (mean - grand_mean) ** 2
        for group, mean in zip(groups, group_means)
    )
    ss_within = sum(
        sum((value - mean) ** 2 for value in group)
        for group, mean in zip(groups, group_means)
    )

    scale = max(1.0, float(np.sum((all_values - grand_mean) ** 2)))
    zero_tolerance = np.finfo(float).eps * scale * sample_count
    if ss_within <= zero_tolerance:
        return _reason(
            "zero_within_group_variance",
            "ANOVA cannot estimate residual variance because observations within every treatment are constant.",
        )

    ms_between = ss_between / df_between
    ms_within = ss_within / df_within
    f_statistic = ms_between / ms_within
    p_value = stats.f.sf(f_statistic, df_between, df_within)

    return {
        "performed": True,
        "F": _rounded(f_statistic),
        "p": _probability(p_value),
        "SS": _rounded(ss_between),
        "MS": _rounded(ms_between),
        "DF": int(df_between),
        "significant": bool(p_value < 0.05),
    }


def calculate_tukey(scores_by_treatment, anova_result):
    if not anova_result or not anova_result.get("performed", False):
        detail = "Tukey HSD requires a completed ANOVA."
        if anova_result and anova_result.get("reason"):
            detail += " " + anova_result["reason"]["detail"]
        return _reason("anova_not_performed", detail)
    if not anova_result["significant"]:
        return _reason(
            "anova_not_significant",
            "Tukey HSD was not performed because the ANOVA p-value is at least 0.05.",
        )

    labels = list(scores_by_treatment)
    groups = [_clean_scores(scores_by_treatment[label]) for label in labels]
    try:
        result = stats.tukey_hsd(*groups)
        comparisons = []
        for first in range(len(labels)):
            for second in range(first + 1, len(labels)):
                p_value = float(result.pvalue[first][second])
                comparisons.append(
                    {
                        "A": labels[first],
                        "B": labels[second],
                        "p": _probability(p_value),
                        "significant": bool(p_value < 0.05),
                    }
                )
    except (ValueError, FloatingPointError):
        return _reason(
            "undefined_tukey_result",
            "Tukey HSD did not produce finite pairwise probabilities.",
        )

    return {"performed": True, "comparisons": comparisons}


def calculate_regression(scores_by_treatment, experiment):
    controls = {
        control
        for control in (
            experiment.get("negControl", ""),
            experiment.get("posControl", ""),
            experiment.get("solControl", ""),
        )
        if control
    }
    x_values = []
    y_values = []

    for treatment, scores in scores_by_treatment.items():
        if treatment in controls:
            continue
        try:
            concentration = float(treatment.split()[0])
        except (ValueError, IndexError):
            continue
        if not np.isfinite(concentration):
            continue
        for score in _clean_scores(scores):
            x_values.append(concentration)
            y_values.append(score)

    observation_count = len(x_values)
    if observation_count < 3:
        return _reason(
            "insufficient_observations",
            f"Linear regression requires at least 3 observations; received {observation_count}.",
        )
    if len(set(x_values)) < 2:
        return _reason(
            "single_concentration",
            "Linear regression requires at least 2 distinct numeric concentrations.",
        )
    if np.ptp(y_values) == 0:
        return _reason(
            "constant_response",
            "Linear regression and Pearson correlation are undefined for a constant response.",
        )

    x = np.asarray(x_values, dtype=float)
    y = np.asarray(y_values, dtype=float)
    regression = stats.linregress(x, y)
    degrees_freedom = observation_count - 2
    t_critical = float(stats.t.ppf(0.975, degrees_freedom))
    ci_low = regression.slope - t_critical * regression.stderr
    ci_high = regression.slope + t_critical * regression.stderr
    pearson_r, pearson_p = stats.pearsonr(x, y)

    power = _correlation_power(pearson_r, observation_count)

    return {
        "performed": True,
        "regression": {
            "slope": _rounded(regression.slope),
            "intercept": _rounded(regression.intercept),
            "r2": _rounded(regression.rvalue**2),
            "p": _probability(regression.pvalue),
            "ci_low": _rounded(ci_low),
            "ci_high": _rounded(ci_high),
        },
        "pearson": {
            "r": _rounded(pearson_r),
            "p": _probability(pearson_p),
            "power": _rounded(power, 3),
        },
    }


def generate_score_chart(scores_by_treatment, tukey_result, experiment, lang):
    treatments = list(scores_by_treatment)
    means = [
        float(np.mean(scores_by_treatment[treatment]))
        if scores_by_treatment[treatment]
        else 0
        for treatment in treatments
    ]
    standard_deviations = [
        float(np.std(scores_by_treatment[treatment]))
        if scores_by_treatment[treatment]
        else 0
        for treatment in treatments
    ]
    reference_control = (
        experiment.get("negControl")
        or experiment.get("solControl")
        or experiment.get("posControl")
        or treatments[0]
    )

    figure, axes = plt.subplots(figsize=(9, 5))
    figure.patch.set_facecolor("#161b22")
    axes.set_facecolor("#161b22")
    axes.bar(
        treatments,
        means,
        yerr=standard_deviations,
        color="#4a9eff",
        alpha=0.85,
        error_kw={"ecolor": "#8b949e", "capsize": 4},
    )

    comparisons = tukey_result.get("comparisons", []) if tukey_result else []
    for comparison in comparisons:
        other = None
        if comparison["A"] == reference_control:
            other = comparison["B"]
        elif comparison["B"] == reference_control:
            other = comparison["A"]
        if other in treatments:
            index = treatments.index(other)
            symbol = (
                "**"
                if comparison["p"] <= 0.01
                else "*" if comparison["p"] <= 0.05 else ""
            )
            if symbol:
                axes.annotate(
                    symbol,
                    xy=(index, means[index] + standard_deviations[index]),
                    ha="center",
                    va="bottom",
                    fontsize=13,
                    color="#f0f6fc",
                    fontweight="bold",
                )

    axes.set_xlabel(
        "Treatments" if lang == "en" else "Tratamentos",
        color="#8b949e",
        fontsize=12,
    )
    axes.set_ylabel(
        "Visual Score (AU)" if lang == "en" else "Score Visual (UA)",
        color="#8b949e",
        fontsize=12,
    )
    axes.tick_params(colors="#8b949e", labelsize=9)
    axes.tick_params(axis="x", labelrotation=30)
    for label in axes.get_xticklabels():
        label.set_horizontalalignment("right")
    for spine in axes.spines.values():
        spine.set_edgecolor("#30363d")

    figure.text(
        0.5,
        -0.02,
        f"** p < 0.01; * p < 0.05; Reference: {reference_control}",
        ha="center",
        fontsize=9,
        color="#8b949e",
    )
    plt.tight_layout()
    return _figure_to_base64(figure)


def calculate_class_summary(experiment):
    treatments = experiment["treatments"]
    class_keys = ["class0", "class1", "class2", "class3", "class4"]
    counts = {
        treatment: {class_key: [] for class_key in class_keys}
        for treatment in treatments
    }

    for replicate in experiment["replicates"]:
        replicate_counts = {
            treatment: {class_key: [] for class_key in class_keys}
            for treatment in treatments
        }
        for gel in replicate["gels"]:
            if (
                gel.get("status", "counted") != "counted"
                or gel.get("completion", "complete") != "complete"
            ):
                continue
            if "nucleoidsPerGel" in experiment and _valid_slide_score(
                gel, float(experiment["nucleoidsPerGel"])
            ) is None:
                continue
            treatment = gel["treatment"]
            if treatment in replicate_counts:
                for class_key in class_keys:
                    replicate_counts[treatment][class_key].append(float(gel[class_key]))

        for treatment in treatments:
            for class_key in class_keys:
                technical_slides = replicate_counts[treatment][class_key]
                if technical_slides:
                    counts[treatment][class_key].append(float(np.mean(technical_slides)))

    return {
        treatment: {
            "means": [
                float(np.mean(counts[treatment][class_key]))
                if counts[treatment][class_key]
                else 0
                for class_key in class_keys
            ],
            "standard_deviations": [
                float(np.std(counts[treatment][class_key]))
                if counts[treatment][class_key]
                else 0
                for class_key in class_keys
            ],
        }
        for treatment in treatments
    }


def generate_classes_chart(experiment, lang):
    treatments = experiment["treatments"]
    class_names = ["Class 0", "Class 1", "Class 2", "Class 3", "Class 4"]
    summary = calculate_class_summary(experiment)
    x_positions = np.arange(len(class_names))
    width = 0.8 / len(treatments)
    colors = ["#4a9eff", "#3fb950", "#d29922", "#f85149", "#bc8cff"]
    figure, axes = plt.subplots(figsize=(10, 5))
    figure.patch.set_facecolor("#161b22")
    axes.set_facecolor("#161b22")

    for index, treatment in enumerate(treatments):
        offset = (index - len(treatments) / 2 + 0.5) * width
        axes.bar(
            x_positions + offset,
            summary[treatment]["means"],
            width,
            yerr=summary[treatment]["standard_deviations"],
            label=treatment,
            color=colors[index % len(colors)],
            alpha=0.85,
            error_kw={"ecolor": "#8b949e", "capsize": 3},
        )

    axes.set_xticks(x_positions)
    axes.set_xticklabels(class_names)
    axes.set_ylabel(
        "Mean Nucleoids" if lang == "en" else "Media de Nucleoides",
        color="#8b949e",
        fontsize=12,
    )
    axes.set_xlabel(
        "Comet Class" if lang == "en" else "Classe do Cometa",
        color="#8b949e",
        fontsize=12,
    )
    axes.tick_params(colors="#8b949e", labelsize=9)
    axes.legend(
        loc="best", fontsize=8, facecolor="#21262d", labelcolor="#e6edf3"
    )
    for spine in axes.spines.values():
        spine.set_edgecolor("#30363d")
    plt.tight_layout()
    return _figure_to_base64(figure)


def _figure_to_base64(figure):
    buffer = io.BytesIO()
    figure.savefig(
        buffer,
        format="png",
        dpi=150,
        bbox_inches="tight",
        facecolor="#161b22",
    )
    plt.close(figure)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


class AnalysisInputError(ValueError):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _treatment_label(experiment, treatment_index):
    return experiment["treatments"][treatment_index]


def _parse_protocol(experiment):
    design = experiment.get("studyDesign")
    metadata = experiment.get("treatmentMetadata")
    treatments = experiment.get("treatments")
    if not isinstance(design, dict):
        raise AnalysisInputError(
            "study_design_unconfigured",
            "A versioned studyDesign is required for analysis schema version 2.",
        )
    if design.get("status") != "configured":
        raise AnalysisInputError(
            "study_design_unconfigured",
            "studyDesign must be explicitly configured before analysis.",
        )
    if not isinstance(treatments, list) or not treatments:
        raise AnalysisInputError("invalid_treatments", "Treatments must be a non-empty list.")
    if not isinstance(metadata, list):
        raise AnalysisInputError(
            "invalid_treatment_metadata", "treatmentMetadata must be a list."
        )

    metadata_by_index = {}
    for item in metadata:
        if not isinstance(item, dict) or not isinstance(item.get("treatmentIndex"), int):
            raise AnalysisInputError(
                "invalid_treatment_metadata",
                "Every treatmentMetadata item must have an integer treatmentIndex.",
            )
        index = item["treatmentIndex"]
        if index in metadata_by_index or index < 0 or index >= len(treatments):
            raise AnalysisInputError(
                "invalid_treatment_metadata",
                "treatmentMetadata indices must be unique and refer to an existing treatment.",
            )
        metadata_by_index[index] = item

    reference_index = design.get("primaryReferenceTreatmentIndex")
    primary_indices = design.get("primaryTreatmentIndices")
    if not isinstance(reference_index, int) or not isinstance(primary_indices, list):
        raise AnalysisInputError(
            "invalid_primary_population",
            "studyDesign must define a primary reference and primary treatment indices.",
        )
    if not primary_indices or any(not isinstance(index, int) for index in primary_indices):
        raise AnalysisInputError(
            "invalid_primary_population", "At least one primary treatment is required."
        )
    all_primary = [reference_index] + primary_indices
    if len(set(all_primary)) != len(all_primary) or any(
        index < 0 or index >= len(treatments) for index in all_primary
    ):
        raise AnalysisInputError(
            "invalid_primary_population",
            "Primary treatment indices must be unique existing treatments.",
        )
    missing_metadata = [index for index in all_primary if index not in metadata_by_index]
    if missing_metadata:
        raise AnalysisInputError(
            "missing_treatment_metadata",
            f"Missing treatmentMetadata for indices: {missing_metadata}.",
        )
    for index in primary_indices:
        concentration = metadata_by_index[index].get("concentration")
        if isinstance(concentration, bool) or not isinstance(concentration, (int, float)):
            raise AnalysisInputError(
                "invalid_concentration_metadata",
                f"Treatment index {index} requires a numeric concentration.",
            )
        if not np.isfinite(float(concentration)):
            raise AnalysisInputError(
                "invalid_concentration_metadata",
                f"Treatment index {index} has a non-finite concentration.",
            )

    alpha = design.get("alpha", 0.05)
    assay_type = design.get("assayType")
    alternative = design.get("alternative", "two-sided")
    adjustment = design.get("pAdjustment")
    reference_as_zero = design.get("trendReferenceAsZero")
    if alpha != 0.05 or alternative != "two-sided" or adjustment != "holm":
        raise AnalysisInputError(
            "unsupported_analysis_protocol",
            "Analysis schema version 2 requires alpha 0.05, two-sided tests, and Holm adjustment.",
        )
    if reference_as_zero is not True:
        raise AnalysisInputError(
            "unsupported_analysis_protocol",
            "The primary reference must be included as concentration zero in dose trend.",
        )
    if assay_type not in ("genotoxicity", "antigenotoxicity"):
        raise AnalysisInputError(
            "invalid_assay_type",
            "studyDesign.assayType must be genotoxicity or antigenotoxicity.",
        )

    validation = design.get("validationComparison")
    if validation is not None:
        if not isinstance(validation, dict):
            raise AnalysisInputError(
                "invalid_validation_comparison", "validationComparison must be an object or null."
            )
        validation_reference = validation.get("referenceTreatmentIndex")
        validation_treatment = validation.get("treatmentIndex")
        if (
            not isinstance(validation_reference, int)
            or not isinstance(validation_treatment, int)
            or validation_reference == validation_treatment
            or min(validation_reference, validation_treatment) < 0
            or max(validation_reference, validation_treatment) >= len(treatments)
        ):
            raise AnalysisInputError(
                "invalid_validation_comparison",
                "validationComparison must identify two distinct existing treatments.",
            )

    design_version = design.get("version")
    if design_version != 1:
        raise AnalysisInputError(
            "invalid_study_design_version", "studyDesign.version must be 1."
        )
    return {
        "studyDesignVersion": design_version,
        "assayType": assay_type,
        "primaryReferenceTreatmentIndex": reference_index,
        "primaryReferenceTreatment": _treatment_label(experiment, reference_index),
        "primaryTreatmentIndices": primary_indices,
        "validationComparison": validation,
        "alpha": 0.05,
        "alternative": "two-sided",
        "multiplicityAdjustment": "holm",
        "confidenceLevel": 0.95,
        "includePrimaryReferenceAsZero": True,
    }, metadata_by_index


def _gel_treatment_index(gel, treatments):
    index = gel.get("treatmentIndex")
    if isinstance(index, int) and 0 <= index < len(treatments):
        return index
    treatment = gel.get("treatment")
    try:
        return treatments.index(treatment)
    except ValueError:
        return None


def _valid_slide_score(gel, target):
    if gel.get("status") != "counted" or gel.get("completion") != "complete":
        return None
    try:
        classes = [float(gel[f"class{index}"]) for index in range(5)]
    except (KeyError, TypeError, ValueError):
        return None
    if not all(np.isfinite(value) and value >= 0 for value in classes):
        return None
    reported_total = gel.get("total", sum(classes))
    try:
        reported_total = float(reported_total)
    except (TypeError, ValueError):
        return None
    tolerance = np.finfo(float).eps * max(1.0, target) * 16
    if (
        not np.isfinite(reported_total)
        or abs(reported_total - target) > tolerance
        or abs(sum(classes) - target) > tolerance
    ):
        return None
    score = (0.25 * classes[1] + 0.50 * classes[2] + 0.75 * classes[3] + classes[4]) / target * 100
    return _finite(score)


def build_block_matrix(experiment, protocol):
    treatments = experiment["treatments"]
    try:
        target = float(experiment["nucleoidsPerGel"])
    except (KeyError, TypeError, ValueError):
        raise AnalysisInputError(
            "invalid_nucleoid_target", "nucleoidsPerGel must be a positive finite number."
        )
    if not np.isfinite(target) or target <= 0:
        raise AnalysisInputError(
            "invalid_nucleoid_target", "nucleoidsPerGel must be a positive finite number."
        )
    replicates = experiment.get("replicates")
    if not isinstance(replicates, list) or not replicates:
        raise AnalysisInputError("no_blocks", "At least one independent experiment is required.")

    primary_indices = [protocol["primaryReferenceTreatmentIndex"]] + protocol["primaryTreatmentIndices"]
    blocks = []
    seen_numbers = set()
    for replicate in replicates:
        replicate_number = replicate.get("replicateNumber")
        if (
            isinstance(replicate_number, bool)
            or not isinstance(replicate_number, (int, float))
            or not float(replicate_number).is_integer()
            or replicate_number <= 0
            or replicate_number in seen_numbers
        ):
            raise AnalysisInputError(
                "invalid_block_identity",
                    "Every independent experiment requires a unique positive integer replicateNumber.",
            )
        replicate_number = int(replicate_number)
        seen_numbers.add(replicate_number)
        gels = replicate.get("gels", [])
        assignments = replicate.get("assignments", [])
        cells = []
        for treatment_index, treatment in enumerate(treatments):
            treatment_gels = [
                gel for gel in gels if _gel_treatment_index(gel, treatments) == treatment_index
            ]
            treatment_assignments = [
                item for item in assignments if item.get("treatmentIndex") == treatment_index
            ]
            valid_scores = []
            for gel in treatment_gels:
                score = _valid_slide_score(gel, target)
                if score is not None:
                    valid_scores.append(score)
            absent_slides = sum(item.get("status") == "absent" for item in treatment_assignments)
            expected_slides = len(treatment_assignments) or experiment.get(
                "slidesPerTreatment", len(treatment_gels)
            )
            if (
                isinstance(expected_slides, bool)
                or not isinstance(expected_slides, (int, float))
                or not float(expected_slides).is_integer()
                or expected_slides < 0
            ):
                raise AnalysisInputError(
                    "invalid_expected_slide_count",
                    "The expected technical slide count must be a non-negative integer.",
                )
            expected_slides = int(expected_slides)
            invalid_slides = len(treatment_gels) - len(valid_scores)
            cell = {
                "replicateNumber": replicate_number,
                "treatmentIndex": treatment_index,
                "treatment": treatment,
                "expectedSlides": expected_slides,
                "recordedSlides": len(treatment_gels),
                "countedSlides": len(treatment_gels),
                "validSlides": len(valid_scores),
                "completeSlides": len(valid_scores),
                "invalidSlides": invalid_slides,
                "incompleteSlides": invalid_slides,
                "absentSlides": absent_slides,
                "score": _finite(np.mean(valid_scores)) if valid_scores else None,
                "technicalReplicationComplete": bool(
                    expected_slides > 0 and len(valid_scores) == expected_slides
                ),
            }
            cells.append(cell)

        cell_by_index = {cell["treatmentIndex"]: cell for cell in cells}
        missing = [index for index in primary_indices if cell_by_index[index]["score"] is None]
        blocks.append(
            {
                "replicateNumber": replicate_number,
                "primaryIncluded": not missing,
                "primaryExclusionReasons": [
                    {
                        "code": "no_valid_slides",
                        "detail": "No complete valid technical slide is available for this cell.",
                        "treatmentIndex": index,
                        "treatment": treatments[index],
                    }
                    for index in missing
                ],
                "cells": cells,
            }
        )
    return blocks


def _population(blocks, protocol):
    included = [block["replicateNumber"] for block in blocks if block["primaryIncluded"]]
    excluded = [
        {
            "replicateNumber": block["replicateNumber"],
            "reasons": block["primaryExclusionReasons"],
        }
        for block in blocks
        if not block["primaryIncluded"]
    ]
    validation = protocol["validationComparison"]
    validation_included = []
    validation_excluded = []
    if validation is not None:
        indices = [validation["referenceTreatmentIndex"], validation["treatmentIndex"]]
        for block in blocks:
            cells = {cell["treatmentIndex"]: cell for cell in block["cells"]}
            missing = [index for index in indices if cells[index]["score"] is None]
            if missing:
                validation_excluded.append(
                    {
                        "replicateNumber": block["replicateNumber"],
                        "reasons": [
                            {
                                "code": "no_valid_slides",
                                "detail": "No complete valid technical slide is available for this validation cell.",
                                "treatmentIndex": index,
                                "treatment": cells[index]["treatment"],
                            }
                            for index in missing
                        ],
                    }
                )
            else:
                validation_included.append(block["replicateNumber"])
    return {
        "unit": "independent_experiment",
        "technicalSlidesAveragedWithinCell": True,
        "blocks": blocks,
        "primary": {
            "includedBlockNumbers": included,
            "includedBlockCount": len(included),
            "excludedBlocks": excluded,
        },
        "validation": {
            "includedBlockNumbers": validation_included,
            "includedBlockCount": len(validation_included),
            "excludedBlocks": validation_excluded,
        },
    }


def _included_values(blocks, treatment_indices, block_numbers):
    selected = set(block_numbers)
    rows = []
    for block in blocks:
        if block["replicateNumber"] not in selected:
            continue
        cells = {cell["treatmentIndex"]: cell for cell in block["cells"]}
        rows.append([cells[index]["score"] for index in treatment_indices])
    return np.asarray(rows, dtype=float)


def _rcbd_anova(values, treatment_indices, experiment):
    block_count, treatment_count = values.shape
    residual_df = (block_count - 1) * (treatment_count - 1)
    if block_count < 2 or treatment_count < 2 or residual_df <= 0:
        return _reason(
            "insufficient_complete_blocks",
            "RCBD analysis requires at least two complete independent experiments and two treatments.",
        )
    grand_mean = float(np.mean(values))
    treatment_means = np.mean(values, axis=0)
    block_means = np.mean(values, axis=1)
    ss_total = float(np.sum((values - grand_mean) ** 2))
    ss_treatment = float(block_count * np.sum((treatment_means - grand_mean) ** 2))
    ss_block = float(treatment_count * np.sum((block_means - grand_mean) ** 2))
    ss_residual = max(0.0, ss_total - ss_treatment - ss_block)
    mse = ss_residual / residual_df
    tolerance = np.finfo(float).eps * max(1.0, ss_total) * values.size * 16
    if ss_residual <= tolerance:
        return _reason(
            "zero_residual_variance",
            "The additive block model cannot estimate a positive residual variance.",
        )
    treatment_df = treatment_count - 1
    block_df = block_count - 1
    treatment_ms = ss_treatment / treatment_df
    block_ms = ss_block / block_df
    treatment_f = treatment_ms / mse
    block_f = block_ms / mse
    return {
        "performed": True,
        "model": "score ~ treatment + block",
        "blockCount": block_count,
        "treatmentIndices": treatment_indices,
        "residualDF": residual_df,
        "MSE": _finite(mse),
        "terms": [
            {
                "term": "treatment",
                "SS": _finite(ss_treatment),
                "DF": treatment_df,
                "MS": _finite(treatment_ms),
                "F": _finite(treatment_f),
                "p": _probability(stats.f.sf(treatment_f, treatment_df, residual_df)),
            },
            {
                "term": "block",
                "SS": _finite(ss_block),
                "DF": block_df,
                "MS": _finite(block_ms),
                "F": _finite(block_f),
                "p": _probability(stats.f.sf(block_f, block_df, residual_df)),
            },
            {
                "term": "residual",
                "SS": _finite(ss_residual),
                "DF": residual_df,
                "MS": _finite(mse),
            },
        ],
    }


def _holm_adjust(p_values):
    count = len(p_values)
    order = sorted(range(count), key=lambda index: p_values[index])
    adjusted = [0.0] * count
    running = 0.0
    for rank, index in enumerate(order):
        running = max(running, (count - rank) * p_values[index])
        adjusted[index] = min(1.0, running)
    return adjusted


def _comparison_result(reference_index, treatment_index, values, mse, residual_df, experiment):
    reference_mean = float(np.mean(values[:, 0]))
    treatment_mean = float(np.mean(values[:, 1]))
    difference = treatment_mean - reference_mean
    standard_error = float(np.sqrt(mse * 2 / values.shape[0]))
    t_statistic = difference / standard_error
    p_value = float(2 * stats.t.sf(abs(t_statistic), residual_df))
    critical = float(stats.t.ppf(0.975, residual_df))
    return {
        "referenceTreatmentIndex": reference_index,
        "referenceTreatment": _treatment_label(experiment, reference_index),
        "treatmentIndex": treatment_index,
        "treatment": _treatment_label(experiment, treatment_index),
        "blockCount": int(values.shape[0]),
        "referenceMean": _finite(reference_mean),
        "treatmentMean": _finite(treatment_mean),
        "difference": _finite(difference),
        "standardError": _finite(standard_error),
        "t": _finite(t_statistic),
        "DF": int(residual_df),
        "ciLow": _finite(difference - critical * standard_error),
        "ciHigh": _finite(difference + critical * standard_error),
        "pRaw": _probability(p_value),
        "direction": "higher" if difference > 0 else "lower" if difference < 0 else "equal",
    }


def calculate_primary_comparisons(values, anova, protocol, experiment):
    if not anova.get("performed", False):
        return _reason(
            "block_anova_not_estimable",
            "Planned comparisons require an estimable common residual MSE. "
            + anova["reason"]["detail"],
        )
    reference_index = protocol["primaryReferenceTreatmentIndex"]
    comparisons = []
    for column, treatment_index in enumerate(protocol["primaryTreatmentIndices"], start=1):
        comparison = _comparison_result(
            reference_index,
            treatment_index,
            values[:, [0, column]],
            anova["MSE"],
            anova["residualDF"],
            experiment,
        )
        comparisons.append(comparison)
    adjusted = _holm_adjust([comparison["pRaw"] for comparison in comparisons])
    for comparison, p_adjusted in zip(comparisons, adjusted):
        comparison["pAdjusted"] = _probability(p_adjusted)
        comparison["significant"] = bool(p_adjusted < protocol["alpha"])
    return {
        "performed": True,
        "family": "each_primary_concentration_vs_reference",
        "familySize": len(comparisons),
        "adjustment": "holm",
        "confidenceLevel": 0.95,
        "confidenceIntervals": "nominal",
        "omnibusGateUsed": False,
        "comparisons": comparisons,
    }


def calculate_control_response(blocks, population, protocol, experiment):
    validation = protocol["validationComparison"]
    if validation is None:
        return _reason(
            "validation_comparison_not_configured",
            "No separate validation comparison was configured in studyDesign.",
        )
    indices = [validation["referenceTreatmentIndex"], validation["treatmentIndex"]]
    block_numbers = population["validation"]["includedBlockNumbers"]
    values = _included_values(blocks, indices, block_numbers)
    if values.size == 0:
        return _reason(
            "no_complete_validation_blocks",
            "No block contains both validation treatments with a valid cell.",
        )
    anova = _rcbd_anova(values, indices, experiment)
    if not anova.get("performed", False):
        result = dict(anova)
        result["blockAnova"] = anova
        return result
    comparison = _comparison_result(
        indices[0], indices[1], values, anova["MSE"], anova["residualDF"], experiment
    )
    comparison["significant"] = bool(comparison["pRaw"] < protocol["alpha"])
    return {
        "performed": True,
        "purpose": "separate_validation_comparison",
        "blockNumbers": block_numbers,
        "blockAnova": anova,
        "comparison": comparison,
        "note": {
            "code": "low_residual_degrees_of_freedom",
            "detail": (
                "The two-treatment validation block model estimates a residual with few "
                "degrees of freedom. The separate model is kept intentionally rather than "
                "pooling the error with the primary population."
            ),
        },
    }


def calculate_dose_trend(values, treatment_indices, metadata_by_index, protocol):
    block_count, treatment_count = values.shape
    if block_count < 2:
        return _reason(
            "insufficient_complete_blocks",
            "Block-adjusted dose trend requires at least two complete independent experiments.",
        )
    doses = [0.0] + [
        float(metadata_by_index[index]["concentration"])
        for index in protocol["primaryTreatmentIndices"]
    ]
    if len(set(doses)) < 2:
        return _reason(
            "single_concentration",
            "Block-adjusted dose trend requires at least two distinct concentrations.",
        )
    y = values.reshape(-1)
    block_ids = np.repeat(np.arange(block_count), treatment_count)
    x_dose = np.tile(np.asarray(doses, dtype=float), block_count)
    columns = [np.ones(y.size)]
    columns.extend((block_ids == index).astype(float) for index in range(1, block_count))
    columns.append(x_dose)
    design = np.column_stack(columns)
    rank = int(np.linalg.matrix_rank(design))
    residual_df = int(y.size - rank)
    if rank != design.shape[1] or residual_df <= 0:
        return _reason(
            "singular_trend_model", "The block-adjusted dose trend design matrix is singular."
        )
    coefficients, _, _, _ = np.linalg.lstsq(design, y, rcond=None)
    fitted = design @ coefficients
    residuals = y - fitted
    ss_residual = float(residuals @ residuals)
    ss_total = float(np.sum((y - np.mean(y)) ** 2))
    tolerance = np.finfo(float).eps * max(1.0, ss_total) * y.size * 16
    if ss_residual <= tolerance:
        return _reason(
            "zero_residual_variance",
            "The block-adjusted dose trend cannot estimate a positive residual variance.",
        )
    mse = ss_residual / residual_df
    covariance = mse * np.linalg.inv(design.T @ design)
    slope = float(coefficients[-1])
    standard_error = float(np.sqrt(covariance[-1, -1]))
    t_statistic = slope / standard_error
    p_value = float(2 * stats.t.sf(abs(t_statistic), residual_df))
    critical = float(stats.t.ppf(0.975, residual_df))
    reduced_design = design[:, :-1]
    reduced_rank = int(np.linalg.matrix_rank(reduced_design))
    reduced_residual_df = int(y.size - reduced_rank)
    if reduced_rank == reduced_design.shape[1] and reduced_residual_df > 0:
        reduced_coefficients, _, _, _ = np.linalg.lstsq(reduced_design, y, rcond=None)
        reduced_residuals = y - reduced_design @ reduced_coefficients
        reduced_ss_residual = float(reduced_residuals @ reduced_residuals)
        r2_partial = 1.0 - ss_residual / reduced_ss_residual
    else:
        r2_partial = 0.0
    return {
        "performed": True,
        "model": "score ~ block + concentration (linear)",
        "trendKind": "linear",
        "blockCount": block_count,
        "observationCount": int(y.size),
        "residualDF": residual_df,
        "MSE": _finite(mse),
        "treatmentDoses": [
            {"treatmentIndex": index, "concentration": _finite(dose)}
            for index, dose in zip(treatment_indices, doses)
        ],
        "referenceIncludedAsZero": True,
        "slope": _finite(slope),
        "standardError": _finite(standard_error),
        "t": _finite(t_statistic),
        "DF": residual_df,
        "ciLow": _finite(slope - critical * standard_error),
        "ciHigh": _finite(slope + critical * standard_error),
        "p": _probability(p_value),
        "r2": _finite(1 - ss_residual / ss_total),
        "r2Partial": _finite(r2_partial),
        "significant": bool(p_value < protocol["alpha"]),
    }


def _scores_and_descriptive(blocks, treatment_indices, included_block_numbers):
    selected = set(included_block_numbers)
    score_rows = []
    descriptive = []
    for treatment_index in treatment_indices:
        values = []
        treatment = None
        for block in blocks:
            if block["replicateNumber"] not in selected:
                continue
            cell = block["cells"][treatment_index]
            treatment = cell["treatment"]
            values.append(cell["score"])
            score_rows.append(
                {
                    "replicateNumber": block["replicateNumber"],
                    "treatmentIndex": treatment_index,
                    "treatment": treatment,
                    "score": cell["score"],
                    "validSlides": cell["validSlides"],
                    "expectedSlides": cell["expectedSlides"],
                }
            )
        if values:
            mean = _finite(np.mean(values))
            standard_deviation = (
                _finite(np.std(values, ddof=1)) if len(values) > 1 else 0.0
            )
            descriptive.append(
                {
                    "treatmentIndex": treatment_index,
                    "treatment": treatment,
                    "blockCount": len(values),
                    "mean": mean,
                    "standardDeviation": standard_deviation,
                    "coefficientOfVariation": (
                        _finite(standard_deviation / mean * 100.0) if mean > 0 else 0.0
                    ),
                    "minimum": _finite(np.min(values)),
                    "maximum": _finite(np.max(values)),
                }
            )
    return score_rows, descriptive


def _heterogeneity_flag(descriptive):
    deviations = [item["standardDeviation"] for item in descriptive if item["blockCount"] >= 2]
    if len(deviations) < 2:
        return {
            "performed": False,
            "reason": {
                "code": "insufficient_dispersion",
                "detail": "Heterogeneity flag requires at least two treatments with two or more blocks.",
            },
        }
    maximum = max(deviations)
    minimum = min(deviations)
    ratio = (maximum / minimum) if minimum > 0 else None
    flagged = ratio is None or ratio > 3.0
    return {
        "performed": True,
        "flagged": flagged,
        "maximumStandardDeviation": _finite(maximum),
        "minimumStandardDeviation": _finite(minimum),
        "ratio": _finite(ratio) if ratio is not None else None,
        "code": "heterogeneous_variance" if flagged else "homogeneous_variance",
    }


NONPARAMETRIC_ARRANGEMENT_CAP = 5_000_000


def _arcsin_sqrt_transform(values):
    clipped = np.clip(values, 0.0, 100.0)
    return np.arcsin(np.sqrt(clipped / 100.0))


def _page_direction(assay_type):
    return "increasing" if assay_type == "genotoxicity" else "decreasing"


def _friedman_exact(values, treatment_indices):
    block_count, treatment_count = values.shape
    if treatment_count < 3:
        return _reason(
            "insufficient_treatments",
            "Friedman test requires at least three treatments.",
        )
    if block_count < 2:
        return _reason(
            "insufficient_complete_blocks",
            "Friedman test requires at least two complete independent experiments.",
        )
    arrangements = math.factorial(treatment_count) ** block_count
    if arrangements > NONPARAMETRIC_ARRANGEMENT_CAP:
        return _reason(
            "nonparametric_arrangements_exceeded",
            "Exact Friedman enumeration exceeds the computational budget for this design.",
        )
    ranks = stats.rankdata(values, axis=1)
    rank_sums = ranks.sum(axis=0)
    observed_q = 12.0 / (block_count * treatment_count * (treatment_count + 1)) * float(
        np.sum(rank_sums ** 2)
    ) - 3.0 * block_count * (treatment_count + 1)
    perms = list(itertools.permutations(range(treatment_count)))
    distribution = Counter()
    distribution[(0,) * treatment_count] = 1
    for block_index in range(block_count):
        row = ranks[block_index]
        next_distribution = Counter()
        for state, count in distribution.items():
            for perm in perms:
                next_state = tuple(state[j] + row[perm[j]] for j in range(treatment_count))
                next_distribution[next_state] += count
        distribution = next_distribution
    exceeded = 0
    for state, count in distribution.items():
        statistic = 12.0 / (block_count * treatment_count * (treatment_count + 1)) * sum(
            value * value for value in state
        ) - 3.0 * block_count * (treatment_count + 1)
        if statistic >= observed_q - 1e-12:
            exceeded += count
    return {
        "performed": True,
        "blockCount": block_count,
        "treatmentIndices": treatment_indices,
        "statistic": _finite(observed_q),
        "df": treatment_count - 1,
        "pExact": _probability(exceeded / arrangements),
        "exactArrangements": arrangements,
    }


def _page_exact(values, treatment_indices, direction):
    block_count, treatment_count = values.shape
    if treatment_count < 3:
        return _reason(
            "insufficient_treatments",
            "Page test requires at least three treatments.",
        )
    if block_count < 2:
        return _reason(
            "insufficient_complete_blocks",
            "Page test requires at least two complete independent experiments.",
        )
    arrangements = math.factorial(treatment_count) ** block_count
    if arrangements > NONPARAMETRIC_ARRANGEMENT_CAP:
        return _reason(
            "nonparametric_arrangements_exceeded",
            "Exact Page enumeration exceeds the computational budget for this design.",
        )
    primary_data = values if direction == "increasing" else values[:, ::-1]
    opposite_data = values[:, ::-1] if direction == "increasing" else values
    primary = stats.page_trend_test(primary_data, method="exact")
    opposite = stats.page_trend_test(opposite_data, method="exact")
    primary_p = min(1.0, float(primary.pvalue))
    opposite_p = min(1.0, float(opposite.pvalue))
    if primary_p > 1.0 - 1e-12:
        primary_p = 1.0
    if opposite_p > 1.0 - 1e-12:
        opposite_p = 1.0
    return {
        "performed": True,
        "blockCount": block_count,
        "treatmentIndices": treatment_indices,
        "direction": direction,
        "directionSource": "assay_type",
        "statistic": _finite(float(primary.statistic)),
        "pExact": _probability(primary_p),
        "pExactOpposite": _probability(opposite_p),
        "exactArrangements": arrangements,
    }


def generate_block_score_chart(blocks, treatment_indices, block_numbers, experiment, lang):
    values = _included_values(blocks, treatment_indices, block_numbers)
    labels = [_treatment_label(experiment, index) for index in treatment_indices]
    figure, axes = plt.subplots(figsize=(9, 5))
    figure.patch.set_facecolor("#161b22")
    axes.set_facecolor("#161b22")
    x_positions = np.arange(len(labels))
    colors = ["#4a9eff", "#3fb950", "#d29922", "#bc8cff", "#f85149"]
    for index, (row, block_number) in enumerate(zip(values, block_numbers)):
        color = colors[index % len(colors)]
        axes.plot(x_positions, row, color=color, alpha=0.65, linewidth=1.2)
        axes.scatter(x_positions, row, color=color, s=42, label=f"Block {block_number}", zorder=3)
    axes.set_xticks(x_positions)
    axes.set_xticklabels(labels, rotation=30, ha="right")
    axes.set_ylabel("Visual Score (AU)" if lang == "en" else "Score Visual (UA)", color="#8b949e")
    axes.set_xlabel("Primary treatments" if lang == "en" else "Tratamentos principais", color="#8b949e")
    axes.tick_params(colors="#8b949e")
    if len(block_numbers):
        axes.legend(facecolor="#21262d", labelcolor="#e6edf3", fontsize=8)
    for spine in axes.spines.values():
        spine.set_edgecolor("#30363d")
    plt.tight_layout()
    return _figure_to_base64(figure)


def generate_difference_chart(primary_comparisons, lang):
    comparisons = primary_comparisons.get("comparisons", [])
    figure, axes = plt.subplots(figsize=(8, 4.5))
    figure.patch.set_facecolor("#161b22")
    axes.set_facecolor("#161b22")
    if comparisons:
        differences = np.asarray([item["difference"] for item in comparisons])
        low = differences - np.asarray([item["ciLow"] for item in comparisons])
        high = np.asarray([item["ciHigh"] for item in comparisons]) - differences
        y_positions = np.arange(len(comparisons))
        colors = ["#3fb950" if item["significant"] else "#8b949e" for item in comparisons]
        axes.errorbar(differences, y_positions, xerr=np.vstack([low, high]), fmt="none", ecolor="#8b949e", capsize=4)
        axes.scatter(differences, y_positions, color=colors, s=55, zorder=3)
        axes.set_yticks(y_positions)
        axes.set_yticklabels([item["treatment"] for item in comparisons])
    else:
        axes.text(0.5, 0.5, "Not estimable" if lang == "en" else "Nao estimavel", ha="center", va="center", color="#8b949e", transform=axes.transAxes)
        axes.set_yticks([])
    axes.axvline(0, color="#f0f6fc", linewidth=1, linestyle="--")
    axes.set_xlabel("Difference vs reference (95% CI)" if lang == "en" else "Diferenca vs referencia (IC 95%)", color="#8b949e")
    axes.tick_params(colors="#8b949e")
    for spine in axes.spines.values():
        spine.set_edgecolor("#30363d")
    plt.tight_layout()
    return _figure_to_base64(figure)


def _calculate_non_parametric(values, treatment_indices, assay_type):
    if values.size == 0:
        return _reason(
            "no_complete_primary_blocks",
            "Non-parametric sensitivity analysis requires complete primary blocks.",
        )
    direction = _page_direction(assay_type)
    friedman = _friedman_exact(values, treatment_indices)
    page = _page_exact(values, treatment_indices, direction)
    if friedman.get("performed", False) and page.get("performed", False):
        return {
            "performed": True,
            "population": "primary_complete_blocks",
            "friedman": friedman,
            "pageTrend": page,
        }
    reason = friedman if not friedman.get("performed", False) else page
    return {
        "performed": False,
        "reason": reason["reason"],
        "population": "primary_complete_blocks",
    }


def _calculate_transformed_analysis(values, treatment_indices, metadata_by_index, protocol, experiment):
    if values.size == 0:
        return _reason(
            "no_complete_primary_blocks",
            "Transformed sensitivity analysis requires complete primary blocks.",
        )
    transformed = _arcsin_sqrt_transform(values)
    anova = _rcbd_anova(transformed, treatment_indices, experiment)
    comparisons = calculate_primary_comparisons(transformed, anova, protocol, experiment)
    trend = calculate_dose_trend(transformed, treatment_indices, metadata_by_index, protocol)
    return {
        "performed": True,
        "scale": "arcsin_sqrt",
        "blockAnova": anova,
        "primaryComparisons": comparisons,
        "doseTrend": trend,
    }


def analyze_experiment(experiment, lang="en"):
    try:
        protocol, metadata_by_index = _parse_protocol(experiment)
        blocks = build_block_matrix(experiment, protocol)
    except AnalysisInputError as error:
        unavailable = _reason(error.code, error.detail)
        return {
            "analysisSchemaVersion": 2,
            "protocol": unavailable,
            "population": unavailable,
            "descriptive": unavailable,
            "scores": unavailable,
            "blockAnova": unavailable,
            "primaryComparisons": unavailable,
            "controlResponse": unavailable,
            "doseTrend": unavailable,
            "nonParametric": unavailable,
            "transformedAnalysis": unavailable,
            "charts": unavailable,
        }

    population = _population(blocks, protocol)
    treatment_indices = [protocol["primaryReferenceTreatmentIndex"]] + protocol["primaryTreatmentIndices"]
    included_blocks = population["primary"]["includedBlockNumbers"]
    values = _included_values(blocks, treatment_indices, included_blocks)
    if values.size == 0:
        block_anova = _reason(
            "no_complete_primary_blocks",
            "No block contains the primary reference and every primary treatment with a valid cell.",
        )
    else:
        block_anova = _rcbd_anova(values, treatment_indices, experiment)
    primary_comparisons = calculate_primary_comparisons(
        values, block_anova, protocol, experiment
    )
    control_response = calculate_control_response(blocks, population, protocol, experiment)
    dose_trend = (
        calculate_dose_trend(values, treatment_indices, metadata_by_index, protocol)
        if values.size
        else _reason(
            "no_complete_primary_blocks",
            "Dose trend requires complete primary blocks.",
        )
    )
    non_parametric = _calculate_non_parametric(values, treatment_indices, protocol["assayType"])
    transformed_analysis = _calculate_transformed_analysis(
        values, treatment_indices, metadata_by_index, protocol, experiment
    )
    scores, descriptive = _scores_and_descriptive(blocks, treatment_indices, included_blocks)
    heterogeneity_flag = _heterogeneity_flag(descriptive)
    return {
        "analysisSchemaVersion": 2,
        "protocol": protocol,
        "population": population,
        "descriptive": {
            "performed": True,
            "population": "primary_complete_blocks",
            "treatments": descriptive,
            "heterogeneityFlag": heterogeneity_flag,
        },
        "scores": {
            "performed": True,
            "population": "primary_complete_blocks",
            "cells": scores,
        },
        "blockAnova": block_anova,
        "primaryComparisons": primary_comparisons,
        "controlResponse": control_response,
        "doseTrend": dose_trend,
        "nonParametric": non_parametric,
        "transformedAnalysis": transformed_analysis,
        "charts": {
            "scores": generate_block_score_chart(
                blocks, treatment_indices, included_blocks, experiment, lang
            ),
            "differences": generate_difference_chart(primary_comparisons, lang),
            "classes": generate_classes_chart(experiment, lang),
        },
    }


def run_all_analyses(experiment_json, lang):
    experiment = json.loads(experiment_json)
    result = analyze_experiment(experiment, lang)
    return json.dumps(result, allow_nan=False, separators=(",", ":"))


print("CometQuant Python environment ready")
