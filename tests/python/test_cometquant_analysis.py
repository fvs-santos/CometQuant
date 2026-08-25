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
                {"gels": [
                    {"treatment": "A", "status": "counted", "completion": "complete", "class0": 0, "class1": 0, "class2": 0, "class3": 0, "class4": 100},
                    {"treatment": "A", "status": "counted", "completion": "complete", "class0": 100, "class1": 0, "class2": 0, "class3": 0, "class4": 0},
                ]},
                {"gels": [
                    {"treatment": "A", "status": "counted", "completion": "complete", "class0": 100, "class1": 0, "class2": 0, "class3": 0, "class4": 0},
                ]},
            ],
        }
        summary = engine.calculate_class_summary(experiment)["A"]
        self.assertEqual(summary["means"][0], 75.0)
        self.assertEqual(summary["standard_deviations"][0], 25.0)


class BlockAnalysisV2Tests(unittest.TestCase):
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
            (REFERENCE_V2 / "expected.json").read_text(encoding="utf-8")
        )
        cls.result = engine.analyze_experiment(cls.experiment)

    def assert_close(self, actual, expected, tolerance=1e-7):
        self.assertTrue(
            math.isclose(actual, expected, rel_tol=1e-9, abs_tol=tolerance),
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
        self.assertTrue(block["primaryIncluded"])
        self.assertEqual(cell["expectedSlides"], 2)
        self.assertEqual(cell["validSlides"], 1)
        self.assertEqual(cell["invalidSlides"], 1)
        self.assertFalse(cell["technicalReplicationComplete"])
        self.assertEqual(cell["score"], 35.0)

    def test_rcbd_contrasts_control_and_trend_match_independent_scipy_oracle(self):
        self.assert_anova_matches(self.result["blockAnova"], self.expected["blockAnova"])
        comparisons = self.result["primaryComparisons"]
        self.assertTrue(comparisons["performed"])
        self.assertFalse(comparisons["omnibusGateUsed"])
        self.assertEqual(comparisons["familySize"], 3)
        for actual, expected in zip(
            comparisons["comparisons"], self.expected["primaryComparisons"]
        ):
            self.assertEqual(actual["treatmentIndex"], expected["treatmentIndex"])
            for field in (
                "referenceMean",
                "treatmentMean",
                "difference",
                "standardError",
                "t",
                "ciLow",
                "ciHigh",
                "pRaw",
                "pAdjusted",
            ):
                self.assert_close(actual[field], expected[field])
            self.assertEqual(actual["DF"], expected["DF"])

        control = self.result["controlResponse"]
        self.assertTrue(control["performed"])
        self.assertNotIn("valid", control)
        self.assertNotIn("classification", control)
        self.assert_anova_matches(
            control["blockAnova"], self.expected["controlResponse"]["blockAnova"]
        )
        for field in (
            "referenceMean",
            "treatmentMean",
            "difference",
            "standardError",
            "t",
            "ciLow",
            "ciHigh",
            "pRaw",
        ):
            self.assert_close(
                control["comparison"][field],
                self.expected["controlResponse"]["comparison"][field],
            )

        trend = self.result["doseTrend"]
        self.assertTrue(trend["performed"])
        for field in (
            "slope",
            "standardError",
            "t",
            "MSE",
            "ciLow",
            "ciHigh",
            "p",
            "r2",
            "r2Partial",
        ):
            self.assert_close(trend[field], self.expected["doseTrend"][field])
        self.assertEqual(trend["DF"], self.expected["doseTrend"]["DF"])
        self.assertEqual(trend["trendKind"], "linear")
        self.assertEqual(
            [item["concentration"] for item in trend["treatmentDoses"]],
            [0.0, 1.0, 5.0, 10.0],
        )

    def test_non_parametric_matches_independent_exact_oracle(self):
        result = self.result["nonParametric"]
        self.assertTrue(result["performed"])
        self.assertEqual(result["population"], "primary_complete_blocks")
        friedman = result["friedman"]
        self.assertTrue(friedman["performed"])
        self.assertEqual(friedman["treatmentIndices"], [0, 2, 3, 4])
        self.assert_close(friedman["statistic"], self.expected["nonParametric"]["friedman"]["statistic"])
        self.assertEqual(friedman["df"], self.expected["nonParametric"]["friedman"]["df"])
        self.assert_close(friedman["pExact"], self.expected["nonParametric"]["friedman"]["pExact"])
        self.assertEqual(
            friedman["exactArrangements"],
            self.expected["nonParametric"]["friedman"]["exactArrangements"],
        )
        page = result["pageTrend"]
        self.assertTrue(page["performed"])
        self.assertEqual(page["direction"], "increasing")
        self.assertEqual(page["directionSource"], "assay_type")
        self.assert_close(page["statistic"], self.expected["nonParametric"]["pageTrend"]["statistic"])
        self.assert_close(page["pExact"], self.expected["nonParametric"]["pageTrend"]["pExact"])
        self.assert_close(
            page["pExactOpposite"], self.expected["nonParametric"]["pageTrend"]["pExactOpposite"]
        )

    def test_page_direction_derives_from_assay_type(self):
        antigenotoxic = reference_v2_experiment()
        antigenotoxic["studyDesign"]["assayType"] = "antigenotoxicity"
        result = engine.analyze_experiment(antigenotoxic)
        page = result["nonParametric"]["pageTrend"]
        self.assertEqual(page["direction"], "decreasing")
        self.assertEqual(page["directionSource"], "assay_type")

    def test_transformed_analysis_matches_independent_arcsine_sqrt_oracle(self):
        result = self.result["transformedAnalysis"]
        self.assertTrue(result["performed"])
        self.assertEqual(result["scale"], "arcsin_sqrt")
        expected = self.expected["transformedAnalysis"]
        self.assert_anova_matches(result["blockAnova"], expected["blockAnova"])
        for actual, exp in zip(
            result["primaryComparisons"]["comparisons"], expected["primaryComparisons"]
        ):
            self.assertEqual(actual["treatmentIndex"], exp["treatmentIndex"])
            for field in ("difference", "standardError", "t", "pRaw", "pAdjusted"):
                self.assert_close(actual[field], exp[field])
        for field in ("slope", "standardError", "t", "p", "r2Partial"):
            self.assert_close(result["doseTrend"][field], expected["doseTrend"][field])

    def test_descriptive_exposes_dispersion_and_heterogeneity_flag(self):
        descriptive = self.result["descriptive"]
        self.assertTrue(descriptive["performed"])
        expected = self.expected["descriptive"]
        for actual, exp in zip(descriptive["treatments"], expected["treatments"]):
            self.assertEqual(actual["treatmentIndex"], exp["treatmentIndex"])
            self.assert_close(actual["mean"], exp["mean"])
            self.assert_close(actual["standardDeviation"], exp["standardDeviation"])
            self.assert_close(actual["coefficientOfVariation"], exp["coefficientOfVariation"])
        flag = descriptive["heterogeneityFlag"]
        self.assertTrue(flag["performed"])
        self.assertEqual(flag["flagged"], expected["heterogeneityFlag"]["flagged"])
        self.assert_close(flag["maximumStandardDeviation"], expected["heterogeneityFlag"]["maximumStandardDeviation"])
        self.assert_close(flag["minimumStandardDeviation"], expected["heterogeneityFlag"]["minimumStandardDeviation"])
        self.assert_close(flag["ratio"], expected["heterogeneityFlag"]["ratio"])

    def test_non_parametric_requires_at_least_three_treatments(self):
        experiment = reference_v2_experiment()
        experiment["studyDesign"]["primaryTreatmentIndices"] = [2]
        for replicate in experiment["replicates"]:
            replicate["gels"] = [
                gel for gel in replicate["gels"] if gel["treatmentIndex"] not in (3, 4)
            ]
            replicate["assignments"] = [
                item for item in replicate["assignments"] if item["treatmentIndex"] not in (3, 4)
            ]
        result = engine.analyze_experiment(experiment)
        non_parametric = result["nonParametric"]
        self.assertFalse(non_parametric["performed"])
        self.assertEqual(non_parametric["reason"]["code"], "insufficient_treatments")

    def test_non_parametric_fails_structured_on_missing_reference(self):
        experiment = reference_v2_experiment()
        for replicate in experiment["replicates"]:
            for gel in replicate["gels"]:
                if gel["treatmentIndex"] == 0:
                    self._remove_counts(gel)
        result = engine.analyze_experiment(experiment)
        non_parametric = result["nonParametric"]
        self.assertFalse(non_parametric["performed"])
        self.assertEqual(non_parametric["reason"]["code"], "no_complete_primary_blocks")
        transformed = result["transformedAnalysis"]
        self.assertFalse(transformed["performed"])
        self.assertEqual(transformed["reason"]["code"], "no_complete_primary_blocks")

    def test_contract_is_strict_v2_json_without_retired_analyses(self):
        serialized = engine.run_all_analyses(json.dumps(self.experiment), "en")
        parsed = json.loads(serialized, parse_constant=lambda value: self.fail(value))
        self.assertEqual(
            set(parsed),
            {
                "analysisSchemaVersion",
                "protocol",
                "population",
                "descriptive",
                "scores",
                "blockAnova",
                "primaryComparisons",
                "controlResponse",
                "doseTrend",
                "nonParametric",
                "transformedAnalysis",
                "charts",
            },
        )
        self.assertEqual(parsed["analysisSchemaVersion"], 2)
        self.assertEqual(
            parsed["protocol"]["visualScoreDenominator"],
            "effective_counted_nucleoids",
        )
        self.assertTrue(parsed["protocol"]["offTargetSlidesIncluded"])
        self.assertFalse({"shapiro", "tukey", "pearson", "regression"} & set(parsed))
        self.assertEqual(set(parsed["charts"]), {"scores", "differences", "classes"})
        self.assertEqual(set(parsed["nonParametric"]), {"performed", "population", "friedman", "pageTrend"})
        for chart in parsed["charts"].values():
            self.assertTrue(chart.startswith("iVBORw0KGgo"))
            image = Image.open(io.BytesIO(base64.b64decode(chart))).convert("RGB")
            average = ImageStat.Stat(image.resize((64, 64))).mean
            self.assertTrue(all(channel > 190 for channel in average), average)
            self.assertTrue(all(channel > 245 for channel in image.getpixel((0, 0))))

    def test_slide_edit_history_is_not_an_additional_scientific_observation(self):
        without_history = engine.analyze_experiment(self.experiment)
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
        self.assertEqual(engine.analyze_experiment(with_history), without_history)

    def test_replicate_number_identity_is_not_replaced_by_position(self):
        experiment = reference_v2_experiment()
        identities = [7, 11, 19]
        for replicate, identity in zip(experiment["replicates"], identities):
            replicate["replicateNumber"] = identity
        result = engine.analyze_experiment(experiment)
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
        result = engine.analyze_experiment(experiment)
        primary = result["population"]["primary"]
        self.assertEqual(primary["includedBlockNumbers"], [1, 3])
        self.assertEqual(primary["excludedBlocks"][0]["replicateNumber"], 2)
        reason = primary["excludedBlocks"][0]["reasons"][0]
        self.assertEqual(reason["code"], "no_valid_slides")
        self.assertEqual(reason["treatmentIndex"], 3)
        self.assertEqual(result["blockAnova"]["blockCount"], 2)

    def test_trend_uses_metadata_instead_of_parsing_labels(self):
        experiment = reference_v2_experiment()
        experiment["treatments"][2:] = ["low", "middle", "high"]
        for replicate in experiment["replicates"]:
            for gel in replicate["gels"]:
                gel["treatment"] = experiment["treatments"][gel["treatmentIndex"]]
        result = engine.analyze_experiment(experiment)
        self.assertTrue(result["doseTrend"]["performed"])
        self.assert_close(result["doseTrend"]["slope"], self.expected["doseTrend"]["slope"])

    def test_missing_reference_and_zero_residual_variance_have_structured_reasons(self):
        missing_reference = reference_v2_experiment()
        for replicate in missing_reference["replicates"]:
            for gel in replicate["gels"]:
                if gel["treatmentIndex"] == 0:
                    self._remove_counts(gel)
        missing_result = engine.analyze_experiment(missing_reference)
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
        additive_result = engine.analyze_experiment(additive)
        self.assertEqual(
            additive_result["blockAnova"]["reason"]["code"],
            "zero_residual_variance",
        )
        self.assertEqual(
            additive_result["primaryComparisons"]["reason"]["code"],
            "block_anova_not_estimable",
        )
        self.assertEqual(
            additive_result["doseTrend"]["reason"]["code"],
            "zero_residual_variance",
        )

    def test_unconfigured_study_design_returns_the_full_unavailable_contract(self):
        experiment = reference_v2_experiment()
        del experiment["studyDesign"]
        result = engine.analyze_experiment(experiment)
        self.assertEqual(result["analysisSchemaVersion"], 2)
        self.assertEqual(result["protocol"]["reason"]["code"], "study_design_unconfigured")
        self.assertTrue(all(not result[key]["performed"] for key in result if key != "analysisSchemaVersion"))


if __name__ == "__main__":
    unittest.main()
