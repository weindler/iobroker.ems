export type {
	BatteryConsumerId,
	BatteryConsumerRule,
	BatteryConsumersConfig,
	BatteryConsumerAccess,
} from "./types";
export {
	batteryConsumersConfigFromAdapter,
	batteryConsumerRule,
	batteryConsumerIdFromAddon,
} from "./config";
export {
	resolveBatteryConsumerAccess,
	resolveAllBatteryConsumerAccess,
	immersionCriticalNow,
} from "./resolve";
