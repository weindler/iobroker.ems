"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("node:path"));
const test_job_1 = require("./test_job");
function parseJobDir(argv) {
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--job-dir" && argv[i + 1]) {
            return path.resolve(argv[i + 1]);
        }
    }
    const envDir = process.env.PLANNER_JOB_DIR;
    return envDir ? path.resolve(envDir) : null;
}
async function main() {
    const jobDir = parseJobDir(process.argv);
    if (!jobDir) {
        console.error("planner_worker: missing --job-dir or PLANNER_JOB_DIR");
        process.exit(2);
    }
    const outcome = await (0, test_job_1.runPlannerTestJob)(jobDir);
    if (outcome.exitCode !== 0) {
        console.error(outcome.message.slice(0, 512));
    }
    process.exit(outcome.exitCode);
}
void main().catch((e) => {
    console.error(String(e).slice(0, 512));
    process.exit(2);
});
