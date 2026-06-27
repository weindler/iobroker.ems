import { validatePolicySnapshot } from "../core/validate";
import type { PolicySnapshot } from "../core/types";

export function validateGlobalPolicy(policy: PolicySnapshot) {
	return validatePolicySnapshot(policy, { failClosedOnSecurity: true });
}
