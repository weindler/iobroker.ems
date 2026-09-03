/**
 * Operative EMS-Einschätzung — Interpretation, keine zweite Planner-Logik.
 */

export type AssessmentTopicStatus =
	| "idle"
	| "active"
	| "planned"
	| "blocked"
	| "wait"
	| "off"
	| "unknown";

export type AssessmentTopic = {
	status: AssessmentTopicStatus;
	text: string;
	next: string | null;
};

export type AssessmentClimateUnit = {
	unitIndex: number;
	name: string;
	cooling: string;
	heating: string | null;
	dehumidify: string;
	next: string | null;
};

export type OperationalAssessment = {
	schemaVersion: 1;
	generatedAtIso: string;
	overall: {
		status: AssessmentTopicStatus;
		summary: string;
	};
	ev: AssessmentTopic;
	immersion: AssessmentTopic;
	climate: {
		text: string;
		units: AssessmentClimateUnit[];
	};
	battery: AssessmentTopic;
	gridBalance: AssessmentTopic;
	forecast: {
		text: string;
	};
};
