import base64
import csv
import io
import json
import math
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageStat


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

import cometquant_analysis as engine


REFERENCE = ROOT / "tests" / "reference" / "v1"
REFERENCE_V2 = ROOT / "tests" / "reference" / "v2"
REFERENCE_V3 = ROOT / "tests" / "reference" / "v3"


def reference_experiment():
    replicates = {}
    treatments = []
    with (REFERENCE / "slides.csv").open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            treatment = row["treatment"]
            if treatment not in treatments:
                treatments.append(treatment)
            replicate = replicates.setdefault(int(row["replicate"]), {"gels": []})
            score = float(row["score"])
            replicate["gels"].append(
                {
                    "treatment": treatment,
                    "class0": 100 - score,
                    "class1": 0,
                    "class2": 0,
                    "class3": 0,
                    "class4": score,
                    "status": "counted",
                    "completion": "complete",
                }
            )
    return {
        "nucleoidsPerGel": 100,
        "treatments": treatments,
        "replicates": [replicates[number] for number in sorted(replicates)],
        "negControl": "Control",
        "posControl": "",
        "solControl": "",
    }


def reference_v2_experiment():
    replicates = {}
    treatments = []
    metadata = {}
    with (REFERENCE_V2 / "slides.csv").open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            treatment_index = int(row["treatment_index"])
            while len(treatments) <= treatment_index:
                treatments.append(None)
            treatments[treatment_index] = row["treatment"]
            concentration = float(row["concentration"]) if row["concentration"] else None
            roles = {
                0: "negative-control",
                1: "positive-control",
                2: "test-concentration",
                3: "test-concentration",
                4: "test-concentration",
            }
            metadata[treatment_index] = {
                "treatmentIndex": treatment_index,
                "role": roles[treatment_index],
                "concentration": concentration,
            }
            replicate = replicates.setdefault(
                int(row["replicate_number"]), {"assignments": [], "gels": []}
            )
            slide = int(row["slide"])
            replicate["assignments"].append(
                {
                    "treatmentIndex": treatment_index,
                    "gelNumber": slide,
                    "status": "counted",
                }
            )
            score = float(row["score"])
            counted = row["completion"] == "complete"
            replicate["gels"].append(
                {
                    "treatment": row["treatment"],
                    "treatmentIndex": treatment_index,
                    "gelNumber": slide,
                    "class0": 100 - score if counted else 0,
                    "class1": 0,
                    "class2": 0,
                    "class3": 0,
                    "class4": score if counted else 0,
                    "total": 100 if counted else 0,
                    "status": row["status"],
                    "completion": row["completion"],
                }
            )
    for replicate_number, replicate in replicates.items():
        replicate["replicateNumber"] = replicate_number
    return {
        "schemaVersion": 5,
        "nucleoidsPerGel": 100,
        "slidesPerTreatment": 2,
        "treatments": treatments,
        "treatmentMetadata": [metadata[index] for index in range(len(treatments))],
        "studyDesign": {
            "version": 1,
            "status": "configured",
            "assayType": "genotoxicity",
            "primaryReferenceTreatmentIndex": 0,
            "primaryTreatmentIndices": [2, 3, 4],
            "validationComparison": {
                "referenceTreatmentIndex": 0,
                "treatmentIndex": 1,
            },
            "alpha": 0.05,
            "alternative": "two-sided",
            "pAdjustment": "holm",
            "trendReferenceAsZero": True,
            "configurationSource": "pre-collection",
        },
        "replicates": [replicates[number] for number in sorted(replicates)],
    }


def selection_options(experiment, selected=None, reason=None):
    available = sorted(replicate["replicateNumber"] for replicate in experiment["replicates"])
    selected = available if selected is None else selected
    return {
        "selectionSchemaVersion": 1,
        "mode": "explicit",
        "availableReplicateNumbers": available,
        "selectedReplicateNumbers": selected,
        "excludedReplicateNumbers": sorted(set(available) - set(selected)),
        "exclusionReason": reason,
        "selectedAt": "2026-09-01T12:00:00.000Z",
    }


def analyze(experiment, selected=None, reason=None, lang="en"):
    return engine.analyze_experiment(
        experiment,
        lang=lang,
        analysis_options=selection_options(experiment, selected, reason),
    )


class ReferenceResultsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.experiment = reference_experiment()
        cls.expected = json.loads((REFERENCE / "expected.json").read_text(encoding="utf-8"))
        cls.scores = engine.calculate_scores(cls.experiment)

    def assert_close(self, actual, expected):
        self.assertAlmostEqual(actual, expected, delta=0.00001)

    def assert_probability_close(self, actual, expected):
        if expected > 0:
            self.assertGreater(actual, 0)
        if expected < 1e-8:
            matches = abs(math.log10(actual) - math.log10(expected)) <= 1
        else:
            matches = math.isclose(actual, expected, rel_tol=1e-3, abs_tol=0)
        self.assertTrue(matches, f"{actual} != {expected}")

    def test_technical_slides_are_averaged_within_each_repetition(self):
        self.assertEqual(self.scores, self.expected["scores"])
        self.assertEqual(len(self.experiment["replicates"][0]["gels"]), 8)
        self.assertEqual(len(self.scores["Control"]), 5)

    def test_matches_versioned_independent_reference(self):
        shapiro = engine.calculate_shapiro(self.scores)
        for treatment, expected in self.expected["shapiro"].items():
            with self.subTest(test="shapiro", treatment=treatment):
                self.assertTrue(shapiro[treatment]["performed"])
                self.assert_close(shapiro[treatment]["W"], expected["W"])
                self.assert_probability_close(shapiro[treatment]["p"], expected["p"])

        anova = engine.calculate_anova(self.scores)
        self.assertTrue(anova["performed"])
        self.assert_probability_close(anova["p"], self.expected["anova"]["p"])
        for field in ("F", "SS", "MS"):
            self.assert_close(anova[field], self.expected["anova"][field])
        self.assertEqual(anova["DF"], self.expected["anova"]["DF"])

        tukey = engine.calculate_tukey(self.scores, anova)
        self.assertTrue(tukey["performed"])
        self.assertEqual(len(tukey["comparisons"]), len(self.expected["tukey"]))
        for actual, expected in zip(tukey["comparisons"], self.expected["tukey"]):
            self.assertEqual((actual["A"], actual["B"]), (expected["A"], expected["B"]))
            self.assert_probability_close(actual["p"], expected["p"])

        regression = engine.calculate_regression(self.scores, self.experiment)
        self.assertTrue(regression["performed"])
        for field, expected in self.expected["regression"].items():
            if field == "p":
                self.assert_probability_close(regression["regression"][field], expected)
            else:
                self.assert_close(regression["regression"][field], expected)
        for field, expected in self.expected["pearson"].items():
            if field == "p":
                self.assert_probability_close(regression["pearson"][field], expected)
            else:
                self.assert_close(regression["pearson"][field], expected)

class EdgeCaseTests(unittest.TestCase):
    def test_slide_score_uses_the_effective_total(self):
        gel = {
            "class0": 49,
            "class1": 0,
            "class2": 50,
            "class3": 0,
            "class4": 0,
            "total": 99,
            "status": "counted",
            "completion": "incomplete",
        }
        self.assertAlmostEqual(engine._valid_slide_score(gel), 50 / 99 * 50)

    def test_probability_preserves_positive_values_below_machine_epsilon(self):
        self.assertEqual(engine._probability(1e-50), 1e-50)
        self.assertGreater(engine._probability(0), 0)

    def test_shapiro_reports_fewer_than_three_and_zero_variance(self):
        results = engine.calculate_shapiro({"short": [1, 2], "constant": [4, 4, 4]})
        self.assertEqual(results["short"]["reason"]["code"], "insufficient_observations")
        self.assertEqual(results["constant"]["reason"]["code"], "zero_variance")

    def test_anova_does_not_silently_drop_an_insufficient_treatment(self):
        single_group = engine.calculate_anova({"only": [1, 2]})
        self.assertEqual(single_group["reason"]["code"], "insufficient_groups")

        result = engine.calculate_anova({"complete": [1, 2, 3], "short": [4]})
        self.assertFalse(result["performed"])
        self.assertEqual(result["reason"]["code"], "insufficient_repetitions")
        self.assertIn("short (n=1)", result["reason"]["detail"])
        tukey = engine.calculate_tukey({"complete": [1, 2, 3], "short": [4]}, result)
        self.assertEqual(tukey["reason"]["code"], "anova_not_performed")

    def test_anova_and_tukey_report_zero_residual_variance(self):
        anova = engine.calculate_anova({"A": [1, 1], "B": [2, 2]})
        self.assertEqual(anova["reason"]["code"], "zero_within_group_variance")
        tukey = engine.calculate_tukey({"A": [1, 1], "B": [2, 2]}, anova)
        self.assertFalse(tukey["performed"])

    def test_tukey_reports_a_non_significant_anova(self):
        scores = {"A": [1, 2, 3], "B": [1, 2, 3]}
        anova = engine.calculate_anova(scores)
        self.assertTrue(anova["performed"])
        tukey = engine.calculate_tukey(scores, anova)
        self.assertEqual(tukey["reason"]["code"], "anova_not_significant")

    def test_regression_reports_each_undefined_input(self):
        experiment = {"negControl": "", "posControl": "", "solControl": ""}
        cases = [
            ({"1 uM": [1], "2 uM": [2]}, "insufficient_observations"),
            ({"1 uM": [1, 2, 3]}, "single_concentration"),
            ({"1 uM": [4, 4], "2 uM": [4, 4]}, "constant_response"),
        ]
        for scores, reason in cases:
            with self.subTest(reason=reason):
                result = engine.calculate_regression(scores, experiment)
                self.assertFalse(result["performed"])
                self.assertEqual(result["reason"]["code"], reason)

    def test_perfect_correlation_is_finite(self):
        experiment = {"negControl": "", "posControl": "", "solControl": ""}
        result = engine.calculate_regression(
            {"1 uM": [2], "2 uM": [4], "3 uM": [6]}, experiment
        )
        self.assertTrue(result["performed"])
        self.assertEqual(result["pearson"]["r"], 1.0)
        self.assertEqual(result["pearson"]["power"], 1.0)
        json.dumps(result, allow_nan=False)

    def test_correlation_power_uses_the_noncentral_t_distribution(self):
        self.assertAlmostEqual(engine._correlation_power(0.5, 10), 0.30186135, places=8)

    def test_class_chart_aggregates_technical_slides_within_repetitions(self):
        experiment = {
            "treatments": ["A"],
            "replicates": [
                {"replicateNumber": 1, "gels": [
                    {"treatment": "A", "status": "counted", "completion": "complete", "class0": 0, "class1": 0, "class2": 0, "class3": 0, "class4": 100},
                    {"treatment": "A", "status": "counted", "completion": "complete", "class0": 100, "class1": 0, "class2": 0, "class3": 0, "class4": 0},
                ]},
                {"replicateNumber": 2, "gels": [
                    {"treatment": "A", "status": "counted", "completion": "complete", "class0": 100, "class1": 0, "class2": 0, "class3": 0, "class4": 0},
                ]},
            ],
        }
        summary = engine.calculate_class_summary(experiment)["A"]
        self.assertEqual(summary["means"][0], 75.0)
        self.assertEqual(summary["standard_deviations"][0], 25.0)
        selected_summary = engine.calculate_class_summary(experiment, [1])["A"]
        self.assertEqual(selected_summary["means"][0], 50.0)
        self.assertEqual(selected_summary["standard_deviations"][0], 0.0)
        chart = engine.generate_classes_chart(experiment, "en", [1])
        self.assertTrue(chart.startswith("iVBORw0KGgo"))


def four_block_experiment():
    """A synthetic 4-block variant of reference_v2_experiment(), used only to exercise
    diagnostics/influence analysis, which requires at least four independent experiments.
    Per-(block, treatment) jitter (not just a uniform per-block shift) keeps the design from
    being perfectly additive, so the block model has a genuinely estimable positive residual."""
    base = reference_v2_experiment()
    template = base["replicates"][0]
    experiment = json.loads(json.dumps(base))
    experiment["replicates"] = []
    jitter = {
        1: {0: 0, 1: 0, 2: 0, 3: 0, 4: 0},
        2: {0: 2, 1: -1, 2: 1, 3: 2, 4: -2},
        3: {0: -1, 1: 1, 2: -2, 3: 1, 4: 2},
        4: {0: 1, 1: 2, 2: -1, 3: -2, 4: 1},
    }
    for block_number in (1, 2, 3, 4):
        replicate = json.loads(json.dumps(template))
        replicate["replicateNumber"] = block_number
        for gel in replicate["gels"]:
            bump = jitter[block_number][gel["treatmentIndex"]]
            score = max(1, min(99, gel["class4"] + bump))
            gel.update(class0=100 - score, class4=score, total=100, completion="complete")
        experiment["replicates"].append(replicate)
    return experiment


class BlockAnalysisV4Tests(unittest.TestCase):
    @staticmethod
    def _remove_counts(gel):
        for index in range(5):
            gel[f"class{index}"] = 0
        gel["total"] = 0
        gel["completion"] = "incomplete"

    @classmethod
    def setUpClass(cls):
        cls.experiment = reference_v2_experiment()
        cls.expected = json.loads(
            (REFERENCE_V3 / "expected.json").read_text(encoding="utf-8")
        )
        cls.result = analyze(cls.experiment)

    def assert_close(self, actual, expected, tolerance=1e-7):
        self.assertTrue(
            math.isclose(actual, expected, rel_tol=1e-9, abs_tol=tolerance),
            f"{actual} != {expected}",
        )

    def assert_close_qmc(self, actual, expected, rel_tol=1e-4):
        """Looser tolerance for quantities derived from the randomized QMC integration of the
        Dunnett reference distribution -- deterministic given a fixed seed within this engine,
        but not meant to be bitwise-compared against a differently-implemented oracle run with
        a different seed/integration path."""
        self.assertTrue(
            math.isclose(actual, expected, rel_tol=rel_tol, abs_tol=1e-4),
            f"{actual} != {expected}",
        )

    def assert_anova_matches(self, actual, expected):
        self.assertTrue(actual["performed"])
        self.assertEqual(actual["residualDF"], expected["residualDF"])
        self.assert_close(actual["MSE"], expected["MSE"])
        for actual_term, expected_term in zip(actual["terms"], expected["terms"]):
            self.assertEqual(actual_term["term"], expected_term["term"])
            for field in ("SS", "MS", "F", "p"):
                if field in expected_term:
                    self.assert_close(actual_term[field], expected_term[field])
            self.assertEqual(actual_term["DF"], expected_term["DF"])

    def test_fixture_has_exact_design_and_keeps_cell_with_one_valid_slide(self):
        self.assertEqual(len(self.experiment["replicates"]), 3)
        self.assertEqual(sum(len(item["gels"]) for item in self.experiment["replicates"]), 30)
        block = self.result["population"]["blocks"][2]
        cell = block["cells"][4]
        self.assertEqual(block["replicateNumber"], 3)
        self.assertTrue(block["selected"])
        self.assertTrue(block["primaryEligible"])
        self.assertTrue(block["primaryIncluded"])
        self.assertTrue(block["validationEligible"])
        self.assertTrue(block["validationIncluded"])
        self.assertEqual(cell["expectedSlides"], 2)
        self.assertEqual(cell["validSlides"], 1)
        self.assertEqual(cell["invalidSlides"], 1)
        self.assertFalse(cell["technicalReplicationComplete"])
        self.assertEqual(cell["score"], 35.0)

    def test_dunnett_contrasts_control_and_trend_match_independent_oracle(self):
        self.assert_anova_matches(self.result["blockAnova"], self.expected["blockAnova"])
        comparisons = self.result["primaryComparisons"]
        self.assertTrue(comparisons["performed"])
        self.assertFalse(comparisons["omnibusGateUsed"])
        self.assertEqual(comparisons["familySize"], 3)
        self.assertEqual(comparisons["comparisonMethod"], "dunnett")
        self.assertEqual(comparisons["confidenceIntervals"], "simultaneous")
        self.assert_close_qmc(comparisons["dunnettCriticalValue"], self.expected["dunnettCriticalValue"])
        for actual, expected in zip(
            comparisons["comparisons"], self.expected["primaryComparisons"]
        ):
            self.assertEqual(actual["treatmentIndex"], expected["treatmentIndex"])
            for field in ("referenceMean", "treatmentMean", "difference", "standardError", "t", "pRaw"):
                self.assert_close(actual[field], expected[field])
            for field in ("ciLow", "ciHigh", "pAdjusted"):
                self.assert_close_qmc(actual[field], expected[field])
            self.assertEqual(actual["DF"], expected["DF"])
        # All three planned concentrations are expected to show a real increase in this fixture.
        self.assertTrue(all(row["increaseDetected"] for row in comparisons["comparisons"]))

        control = self.result["controlResponse"]
        self.assertTrue(control["performed"])
        self.assertNotIn("valid", control)
        self.assertNotIn("classification", control)
        self.assertNotIn("note", control)
        self.assertEqual(
            {note["code"] for note in control["notes"]},
            {"low_residual_degrees_of_freedom", "elevated_uncertainty_minimum_blocks"},
        )
        for field in ("difference", "t", "pRaw"):
            self.assert_close(
                control["comparison"][field], self.expected["controlResponse"]["comparison"][field]
            )

        trend = self.result["trendAnalysis"]
        self.assertTrue(trend["performed"])
        page = trend["pageTrend"]
        self.assertTrue(page["performed"])
        self.assertEqual(page["treatmentIndices"], [0, 2, 3, 4])
        self.assertEqual(page["direction"], "increasing")
        self.assert_close(page["statistic"], self.expected["trendAnalysis"]["pageTrend"]["statistic"])
        self.assert_close(page["pExact"], self.expected["trendAnalysis"]["pageTrend"]["pExact"])

    def test_dunnett_reproducible_with_fixed_seed(self):
        second_run = analyze(reference_v2_experiment())
        for first, second in zip(
            self.result["primaryComparisons"]["comparisons"],
            second_run["primaryComparisons"]["comparisons"],
        ):
            self.assertEqual(first["pAdjusted"], second["pAdjusted"])
            self.assertEqual(first["ciLow"], second["ciLow"])
            self.assertEqual(first["ciHigh"], second["ciHigh"])

    def test_dunnett_requires_at_least_three_independent_experiments(self):
        result = analyze(self.experiment, [1, 3], "Only two retained for this run")
        for key in ("blockAnova", "primaryComparisons", "trendAnalysis", "controlResponse", "interpretation"):
            self.assertFalse(result[key]["performed"], key)
            self.assertEqual(result[key]["reason"]["code"], "insufficient_independent_experiments", key)
        self.assertTrue(result["descriptive"]["performed"])
        self.assertTrue(result["scores"]["performed"])
        self.assertTrue(result["validation"]["performed"])
        self.assertEqual(result["validation"]["independentExperimentCount"], 2)
        self.assertFalse(result["validation"]["estimable"])

    def test_positive_control_equivalent_to_paired_ttest(self):
        from scipy import stats as scipy_stats

        blocks = self.result["population"]["blocks"]
        reference_scores = []
        positive_scores = []
        for block in blocks:
            cells = {cell["treatmentIndex"]: cell for cell in block["cells"]}
            reference_scores.append(cells[0]["score"])
            positive_scores.append(cells[1]["score"])
        paired = scipy_stats.ttest_rel(positive_scores, reference_scores)
        comparison = self.result["controlResponse"]["comparison"]
        self.assert_close(comparison["t"], float(paired.statistic))
        self.assert_close(comparison["pRaw"], float(paired.pvalue))
        self.assertEqual(comparison["DF"], int(paired.df))

    def test_positive_control_elevated_uncertainty_only_at_minimum_blocks(self):
        four_blocks = four_block_experiment()
        result = analyze(four_blocks)
        codes = {note["code"] for note in result["controlResponse"]["notes"]}
        self.assertNotIn("elevated_uncertainty_minimum_blocks", codes)

    def test_page_direction_derives_from_assay_type(self):
        antigenotoxic = reference_v2_experiment()
        antigenotoxic["studyDesign"]["assayType"] = "antigenotoxicity"
        result = analyze(antigenotoxic)
        page = result["trendAnalysis"]["pageTrend"]
        self.assertEqual(page["direction"], "decreasing")
        self.assertEqual(page["directionSource"], "assay_type")

    def test_descriptive_exposes_dispersion_and_heterogeneity_flag(self):
        descriptive = self.result["descriptive"]
        self.assertTrue(descriptive["performed"])
        expected_v2 = json.loads((REFERENCE_V2 / "expected.json").read_text(encoding="utf-8"))["descriptive"]
        for actual, exp in zip(descriptive["treatments"], expected_v2["treatments"]):
            self.assertEqual(actual["treatmentIndex"], exp["treatmentIndex"])
            self.assert_close(actual["mean"], exp["mean"])
            self.assert_close(actual["standardDeviation"], exp["standardDeviation"])
            self.assert_close(actual["coefficientOfVariation"], exp["coefficientOfVariation"])
        flag = descriptive["heterogeneityFlag"]
        self.assertTrue(flag["performed"])
        self.assertEqual(flag["flagged"], expected_v2["heterogeneityFlag"]["flagged"])

    def test_trend_analysis_requires_at_least_three_treatments(self):
        experiment = reference_v2_experiment()
        experiment["studyDesign"]["primaryTreatmentIndices"] = [2]
        for replicate in experiment["replicates"]:
            replicate["gels"] = [
                gel for gel in replicate["gels"] if gel["treatmentIndex"] not in (3, 4)
            ]
            replicate["assignments"] = [
                item for item in replicate["assignments"] if item["treatmentIndex"] not in (3, 4)
            ]
        result = analyze(experiment)
        trend = result["trendAnalysis"]
        self.assertFalse(trend["performed"])
        self.assertEqual(trend["reason"]["code"], "insufficient_treatments")

    def test_trend_analysis_fails_structured_on_missing_reference(self):
        experiment = reference_v2_experiment()
        for replicate in experiment["replicates"]:
            for gel in replicate["gels"]:
                if gel["treatmentIndex"] == 0:
                    self._remove_counts(gel)
        result = analyze(experiment)
        trend = result["trendAnalysis"]
        self.assertFalse(trend["performed"])
        self.assertEqual(trend["reason"]["code"], "no_complete_primary_blocks")

    def test_validation_reports_design_facts_and_estimability(self):
        validation = self.result["validation"]
        self.assertTrue(validation["performed"])
        self.assertEqual(validation["independentExperimentCount"], 3)
        self.assertEqual(validation["minimumRequiredExperiments"], 3)
        self.assertTrue(validation["estimable"])
        self.assertTrue(validation["basalControlPresent"])
        self.assertTrue(validation["positiveControlPresent"])
        self.assertFalse(validation["viabilityDataAvailable"])
        self.assertEqual(validation["scoreOutOfRangeCount"], 0)
        self.assertFalse(validation["floorCeilingFlag"]["flagged"])
        primary_cells = [
            item for item in validation["cellCompleteness"] if item["treatmentIndex"] in (0, 2, 3, 4)
        ]
        self.assertEqual(len(primary_cells), 3 * 4)

    def test_validation_detects_floor_ceiling_effect(self):
        experiment = reference_v2_experiment()
        for replicate in experiment["replicates"]:
            for gel in replicate["gels"]:
                if gel["treatmentIndex"] in (0, 2, 3, 4):
                    gel.update(class0=99, class1=0, class2=0, class3=0, class4=1, total=100, completion="complete")
        result = analyze(experiment)
        self.assertTrue(result["validation"]["floorCeilingFlag"]["flagged"])

    def test_diagnostics_requires_at_least_four_independent_experiments(self):
        self.assertFalse(self.result["diagnostics"]["performed"])
        self.assertEqual(
            self.result["diagnostics"]["reason"]["code"], "insufficient_blocks_for_influence_analysis"
        )

    def test_diagnostics_reports_leverage_residuals_and_influence_without_new_pvalues(self):
        experiment = four_block_experiment()
        result = analyze(experiment)
        diagnostics = result["diagnostics"]
        self.assertTrue(diagnostics["performed"])
        self.assertAlmostEqual(diagnostics["leverage"], 1 / 4 + 1 / 4 - 1 / 16)
        self.assertEqual(len(diagnostics["residuals"]), 4 * 4)
        self.assertEqual(len(diagnostics["qqPlot"]), 4 * 4)
        self.assertEqual(len(diagnostics["treatmentControlDifferences"]), 4 * 3)
        self.assertEqual(len(diagnostics["influence"]), 4)
        self.assertIsInstance(diagnostics["unstable"], bool)
        serialized = json.dumps(diagnostics)
        self.assertNotIn('"p"', serialized)
        self.assertNotIn("pValue", serialized)
        for row in diagnostics["influence"]:
            self.assertIn("omittedReplicateNumber", row)
            if row["performed"]:
                for comparison in row["comparisons"]:
                    self.assertEqual(
                        set(comparison),
                        {"treatmentIndex", "difference", "direction", "directionChangedFromFullSample"},
                    )

    def test_interpretation_five_conclusion_codes(self):
        protocol = {"assayType": "genotoxicity", "alpha": 0.05}

        def comparisons(*significant_flags):
            return {
                "performed": True,
                "comparisons": [
                    {"treatmentIndex": index, "significant": flag, "direction": "higher"}
                    for index, flag in enumerate(significant_flags)
                ],
            }

        def trend(significant, direction="increasing"):
            return {
                "performed": True,
                "pageTrend": {"performed": True, "direction": direction, "pExact": 0.001 if significant else 0.5},
            }

        valid_control = {
            "performed": True,
            "notes": [],
            "comparison": {"significant": True, "direction": "higher"},
        }
        invalid_control = {
            "performed": True,
            "notes": [],
            "comparison": {"significant": True, "direction": "lower"},
        }
        validation = {"performed": True, "estimable": True, "positiveControlPresent": True, "floorCeilingFlag": {}}
        diagnostics = {"performed": False}

        cases = [
            (comparisons(True, False, False), trend(True), valid_control, "increase_detected_with_ordered_trend"),
            (comparisons(True, False, False), trend(False), valid_control, "increase_detected_without_ordered_trend"),
            (comparisons(False, False, False), trend(True), valid_control, "ordered_trend_without_individual_increase"),
            (comparisons(False, False, False), trend(False), valid_control, "no_increase_detected"),
            (comparisons(True, False, False), trend(True), invalid_control, "inconclusive_validity_not_met"),
        ]
        for comparisons_input, trend_input, control_input, expected_code in cases:
            with self.subTest(expected=expected_code):
                result = engine._build_interpretation(
                    comparisons_input, trend_input, control_input, validation, diagnostics, protocol
                )
                self.assertTrue(result["performed"])
                self.assertEqual(result["conclusionCode"], expected_code)

    def test_interpretation_validity_criterion_distinguishes_nonsignificant_from_wrong_direction(self):
        protocol = {"assayType": "genotoxicity", "alpha": 0.05}
        comparisons = {"performed": True, "comparisons": [{"treatmentIndex": 2, "significant": False, "direction": "higher"}]}
        trend = {"performed": True, "pageTrend": {"performed": True, "direction": "increasing", "pExact": 0.5}}
        validation = {"performed": True, "estimable": True, "positiveControlPresent": True, "floorCeilingFlag": {}}
        diagnostics = {"performed": False}

        not_significant = {"performed": True, "notes": [], "comparison": {"significant": False, "direction": "higher"}}
        result = engine._build_interpretation(comparisons, trend, not_significant, validation, diagnostics, protocol)
        self.assertTrue(result["validityCriterionMet"])
        self.assertEqual(result["validityCode"], "expected_control_response_not_detected")

        wrong_direction = {"performed": True, "notes": [], "comparison": {"significant": True, "direction": "lower"}}
        result = engine._build_interpretation(comparisons, trend, wrong_direction, validation, diagnostics, protocol)
        self.assertFalse(result["validityCriterionMet"])
        self.assertEqual(result["validityCode"], "control_response_unexpected_direction")
        self.assertEqual(result["conclusionCode"], "inconclusive_validity_not_met")

        not_estimable = {"performed": False}
        result = engine._build_interpretation(comparisons, trend, not_estimable, validation, diagnostics, protocol)
        self.assertFalse(result["validityCriterionMet"])
        self.assertEqual(result["validityCode"], "control_response_not_estimable")

    def test_contract_is_strict_v4_json_without_retired_analyses(self):
        experiment = four_block_experiment()
        serialized = engine.run_all_analyses(
            json.dumps(experiment), json.dumps(selection_options(experiment)), "en"
        )
        parsed = json.loads(serialized, parse_constant=lambda value: self.fail(value))
        self.assertEqual(
            set(parsed),
            {
                "analysisSchemaVersion",
                "selection",
                "protocol",
                "population",
                "validation",
                "descriptive",
                "scores",
                "blockAnova",
                "primaryComparisons",
                "controlResponse",
                "trendAnalysis",
                "diagnostics",
                "interpretation",
                "comparisonMethod",
                "charts",
            },
        )
        self.assertEqual(parsed["analysisSchemaVersion"], 4)
        self.assertEqual(parsed["comparisonMethod"], "dunnett")
        self.assertEqual(
            set(parsed["selection"]),
            {
                "performed",
                "selectionSchemaVersion",
                "mode",
                "availableBlockNumbers",
                "selectedBlockNumbers",
                "excludedBlockNumbers",
                "exclusionReason",
                "selectedAt",
            },
        )
        self.assertEqual(
            parsed["protocol"]["visualScoreDenominator"],
            "effective_counted_nucleoids",
        )
        self.assertTrue(parsed["protocol"]["offTargetSlidesIncluded"])
        self.assertFalse(
            {"shapiro", "tukey", "pearson", "regression", "doseTrend", "nonParametric", "transformedAnalysis"}
            & set(parsed)
        )
        self.assertEqual(set(parsed["charts"]), {"scores", "differences", "classes"})
        self.assertEqual(set(parsed["trendAnalysis"]), {"performed", "population", "pageTrend"})
        for chart in parsed["charts"].values():
            self.assertTrue(chart.startswith("iVBORw0KGgo"))
            image = Image.open(io.BytesIO(base64.b64decode(chart))).convert("RGB")
            average = ImageStat.Stat(image.resize((64, 64))).mean
            self.assertTrue(all(channel > 190 for channel in average), average)
            self.assertTrue(all(channel > 245 for channel in image.getpixel((0, 0))))

    def test_slide_edit_history_is_not_an_additional_scientific_observation(self):
        without_history = analyze(self.experiment)
        with_history = json.loads(json.dumps(self.experiment))
        with_history["slideEditHistory"] = [
            {
                "editId": "edit-1",
                "editedAt": "2026-01-03T00:00:00.000Z",
                "editedBy": "Reviewer",
                "reason": "Administrative audit metadata",
                "before": {"gel": {"class0": 100}},
                "after": {"gel": {"class4": 100}},
            }
        ]
        self.assertEqual(analyze(with_history), without_history)

    def test_replicate_number_identity_is_not_replaced_by_position(self):
        experiment = reference_v2_experiment()
        identities = [7, 11, 19]
        for replicate, identity in zip(experiment["replicates"], identities):
            replicate["replicateNumber"] = identity
        result = analyze(experiment)
        self.assertEqual(result["population"]["primary"]["includedBlockNumbers"], identities)
        self.assertEqual(
            sorted({row["replicateNumber"] for row in result["scores"]["cells"]}),
            identities,
        )

    def test_incomplete_primary_cell_excludes_entire_block_explicitly(self):
        experiment = reference_v2_experiment()
        for gel in experiment["replicates"][1]["gels"]:
            if gel["treatmentIndex"] == 3:
                self._remove_counts(gel)
        result = analyze(experiment)
        primary = result["population"]["primary"]
        self.assertEqual(primary["includedBlockNumbers"], [1, 3])
        self.assertEqual(primary["excludedBlocks"][0]["replicateNumber"], 2)
        reason = primary["excludedBlocks"][0]["reasons"][0]
        self.assertEqual(reason["code"], "no_valid_slides")
        self.assertEqual(reason["treatmentIndex"], 3)
        # Only 2 complete primary blocks remain, below the standard minimum of three.
        self.assertFalse(result["blockAnova"]["performed"])
        self.assertEqual(result["blockAnova"]["reason"]["code"], "insufficient_independent_experiments")

    def test_incomplete_primary_cell_exclusion_still_estimable_with_enough_blocks(self):
        experiment = four_block_experiment()
        for gel in experiment["replicates"][1]["gels"]:
            if gel["treatmentIndex"] == 3:
                self._remove_counts(gel)
        result = analyze(experiment)
        primary = result["population"]["primary"]
        self.assertEqual(primary["includedBlockNumbers"], [1, 3, 4])
        self.assertEqual(primary["excludedBlocks"][0]["replicateNumber"], 2)
        self.assertTrue(result["blockAnova"]["performed"])
        self.assertEqual(result["blockAnova"]["blockCount"], 3)
        self.assertTrue(result["primaryComparisons"]["performed"])

    def test_explicit_subset_is_canonical_and_keeps_all_blocks_for_audit(self):
        options = selection_options(self.experiment, [1, 3], "  Prespecified quality review  ")
        options["availableReplicateNumbers"] = [3, 1, 2]
        options["selectedReplicateNumbers"] = [3, 1]
        result = engine.analyze_experiment(
            self.experiment, analysis_options=options
        )

        self.assertEqual(
            result["selection"],
            {
                "performed": True,
                "selectionSchemaVersion": 1,
                "mode": "explicit",
                "availableBlockNumbers": [1, 2, 3],
                "selectedBlockNumbers": [1, 3],
                "excludedBlockNumbers": [2],
                "exclusionReason": "Prespecified quality review",
                "selectedAt": "2026-09-01T12:00:00.000Z",
            },
        )
        population = result["population"]
        self.assertEqual([block["replicateNumber"] for block in population["blocks"]], [1, 2, 3])
        self.assertEqual([block["selected"] for block in population["blocks"]], [True, False, True])
        self.assertEqual(population["primary"]["eligibleBlockNumbers"], [1, 2, 3])
        self.assertEqual(population["primary"]["includedBlockNumbers"], [1, 3])
        self.assertEqual(population["primary"]["excludedBlocks"], [])
        self.assertEqual(population["validation"]["eligibleBlockNumbers"], [1, 2, 3])
        self.assertEqual(population["validation"]["includedBlockNumbers"], [1, 3])
        self.assertEqual(population["validation"]["excludedBlocks"], [])
        self.assertEqual(
            sorted({cell["replicateNumber"] for cell in result["scores"]["cells"]}),
            [1, 3],
        )
        # Only 2 of the 3 available blocks were selected, below the standard minimum of three.
        self.assertFalse(result["blockAnova"]["performed"])
        self.assertEqual(result["blockAnova"]["reason"]["code"], "insufficient_independent_experiments")
        self.assertFalse(result["controlResponse"]["performed"])
        self.assertEqual(
            result["controlResponse"]["reason"]["code"], "insufficient_independent_experiments"
        )

    def test_unselected_ineligible_blocks_remain_auditable_but_not_excluded(self):
        experiment = reference_v2_experiment()
        for replicate in experiment["replicates"][1:]:
            for gel in replicate["gels"]:
                if gel["treatmentIndex"] == 1:
                    self._remove_counts(gel)
        result = analyze(experiment, [1, 3], "Validation cells excluded")
        blocks = result["population"]["blocks"]

        self.assertEqual(
            [(block["selected"], block["validationEligible"], block["validationIncluded"]) for block in blocks],
            [(True, True, True), (False, False, False), (True, False, False)],
        )
        validation = result["population"]["validation"]
        self.assertEqual(validation["eligibleBlockNumbers"], [1])
        self.assertEqual(validation["includedBlockNumbers"], [1])
        self.assertEqual(
            [block["replicateNumber"] for block in validation["excludedBlocks"]], [3]
        )

    def test_no_exclusions_normalizes_reason_to_null(self):
        options = selection_options(self.experiment)
        options["exclusionReason"] = "ignored because every block is selected"
        result = engine.analyze_experiment(self.experiment, analysis_options=options)
        self.assertIsNone(result["selection"]["exclusionReason"])

    def test_invalid_selection_returns_the_full_structured_unavailable_contract(self):
        cases = []

        empty = selection_options(self.experiment)
        empty["selectedReplicateNumbers"] = []
        empty["excludedReplicateNumbers"] = [1, 2, 3]
        empty["exclusionReason"] = "No replicate retained"
        cases.append(("empty", empty, "empty_selected_replicate_numbers"))

        nonexistent = selection_options(self.experiment, [1, 3], "Review")
        nonexistent["selectedReplicateNumbers"] = [1, 4]
        cases.append(
            ("nonexistent", nonexistent, "selected_replicate_numbers_not_available")
        )

        duplicate = selection_options(self.experiment, [1, 3], "Review")
        duplicate["selectedReplicateNumbers"] = [1, 1]
        cases.append(("duplicate", duplicate, "duplicate_selected_replicate_numbers"))

        available = selection_options(self.experiment)
        available["availableReplicateNumbers"] = [1, 2]
        cases.append(("available", available, "available_replicate_numbers_mismatch"))

        excluded = selection_options(self.experiment, [1, 3], "Review")
        excluded["excludedReplicateNumbers"] = []
        cases.append(("excluded", excluded, "excluded_replicate_numbers_mismatch"))

        reason = selection_options(self.experiment, [1, 3])
        cases.append(("reason", reason, "exclusion_reason_required"))

        for label, options, code in cases:
            with self.subTest(label=label):
                result = engine.analyze_experiment(
                    self.experiment, analysis_options=options
                )
                self.assertEqual(result["analysisSchemaVersion"], 4)
                unavailable = set(result) - {"analysisSchemaVersion", "comparisonMethod"}
                self.assertTrue(all(not result[key]["performed"] for key in unavailable))
                self.assertTrue(
                    all(result[key]["reason"]["code"] == code for key in unavailable)
                )

    def test_selection_validates_schema_values_reason_length_and_timestamp(self):
        mutations = [
            ("not_object", None, "invalid_selection_options"),
            ("schema", {"selectionSchemaVersion": 2}, "invalid_selection_schema_version"),
            ("mode", {"mode": "all"}, "invalid_selection_mode"),
            (
                "number",
                {"availableReplicateNumbers": [1, -2, 3]},
                "invalid_available_replicate_numbers",
            ),
            (
                "long_reason",
                {"exclusionReason": "x" * 501},
                "invalid_exclusion_reason",
            ),
            ("timestamp", {"selectedAt": "   "}, "invalid_selected_at"),
        ]
        for label, mutation, code in mutations:
            with self.subTest(label=label):
                if mutation is None:
                    options = None
                else:
                    options = selection_options(self.experiment, [1, 3], "Review")
                    options.update(mutation)
                result = engine.analyze_experiment(
                    self.experiment, analysis_options=options
                )
                self.assertEqual(result["selection"]["reason"]["code"], code)

    def test_missing_reference_and_zero_residual_variance_have_structured_reasons(self):
        missing_reference = reference_v2_experiment()
        for replicate in missing_reference["replicates"]:
            for gel in replicate["gels"]:
                if gel["treatmentIndex"] == 0:
                    self._remove_counts(gel)
        missing_result = analyze(missing_reference)
        self.assertEqual(
            missing_result["blockAnova"]["reason"]["code"],
            "no_complete_primary_blocks",
        )
        self.assertEqual(len(missing_result["population"]["primary"]["excludedBlocks"]), 3)

        additive = reference_v2_experiment()
        doses = [0, None, 1, 5, 10]
        for block_index, replicate in enumerate(additive["replicates"]):
            for gel in replicate["gels"]:
                if gel["treatmentIndex"] in (0, 2, 3, 4):
                    score = 5 + block_index + 2 * doses[gel["treatmentIndex"]]
                    gel.update(class0=100 - score, class4=score, completion="complete")
        additive_result = analyze(additive)
        self.assertEqual(
            additive_result["blockAnova"]["reason"]["code"],
            "zero_residual_variance",
        )
        self.assertEqual(
            additive_result["primaryComparisons"]["reason"]["code"],
            "block_anova_not_estimable",
        )
        # Page L is rank-based and does not need an estimable residual MSE, so the trend
        # analysis is unaffected by the block model's zero-residual-variance degeneracy.
        self.assertTrue(additive_result["trendAnalysis"]["performed"])
        self.assertTrue(additive_result["trendAnalysis"]["pageTrend"]["performed"])

    def test_unconfigured_study_design_returns_the_full_unavailable_contract(self):
        experiment = reference_v2_experiment()
        del experiment["studyDesign"]
        result = analyze(experiment)
        self.assertEqual(result["analysisSchemaVersion"], 4)
        self.assertTrue(result["selection"]["performed"])
        self.assertEqual(result["protocol"]["reason"]["code"], "study_design_unconfigured")
        unavailable = set(result) - {"analysisSchemaVersion", "selection", "comparisonMethod"}
        self.assertTrue(all(not result[key]["performed"] for key in unavailable))


if __name__ == "__main__":
    unittest.main()
