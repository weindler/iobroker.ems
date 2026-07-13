import * as path from "node:path";
import { runPlannerTestJob } from "./test_job";

function parseJobDir(argv: string[]): string | null {
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === "--job-dir" && argv[i + 1]) {
			return path.resolve(argv[i + 1]);
		}
	}
	const envDir = process.env.PLANNER_JOB_DIR;
	return envDir ? path.resolve(envDir) : null;
}

async function main(): Promise<void> {
	const jobDir = parseJobDir(process.argv);
	if (!jobDir) {
		console.error("planner_worker: missing --job-dir or PLANNER_JOB_DIR");
		process.exit(2);
	}

	const outcome = await runPlannerTestJob(jobDir);
	if (outcome.exitCode !== 0) {
		console.error(outcome.message.slice(0, 512));
	}
	process.exit(outcome.exitCode);
}

void main().catch((e) => {
	console.error(String(e).slice(0, 512));
	process.exit(2);
});
