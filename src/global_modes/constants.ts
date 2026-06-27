export const GLOBAL_MODES = ["off", "eco", "balanced", "comfort", "forced"] as const;

export type GlobalMode = (typeof GLOBAL_MODES)[number];

export const DEFAULT_GLOBAL_MODE: GlobalMode = "balanced";

export const ADMIN_CONFIG_KEY_DEFAULT = "global_mode_default";
