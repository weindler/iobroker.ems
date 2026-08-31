/**
 * Eigene Adapter-States, die `onStateChange` erreichen müssen.
 * ioBroker liefert State-Änderungen nur nach explizitem `subscribeStatesAsync`
 * (kein Catch-all). Handler ohne Eintrag hier sind tot.
 */
export const EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS = [
	"global_modes.requested",
	"user_intent.inputs.iobroker.wallbox.request_json",
	"statistics.public_charge.submit_request",
	"statistics.adjust_request",
	"statistics.period_id",
	"ai.daily_analyst.run_now_request",
	"ai.optimize_now_request",
	"ai.user_enabled",
	"backup.export_request",
	"backup.support_export_request",
	"support.diagnostic_request",
	"backup.restore.validate_request",
	"backup.restore.apply_request",
] as const;

export type EmsLightOwnStateSubscription = (typeof EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS)[number];
