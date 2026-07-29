#!/usr/bin/env node
/**
 * Generates vis/ems-dashboard-view.json — import in VIS via "View importieren".
 * Ziel-Auflösung: 1276 × 637 px (volle VIS-Fläche, kein Abschneiden).
 * Charts: iframe → /adapter/ems/ems-charts.html (mit Adapter mitgeliefert, kein vis/www).
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREFIX = "ems.0";

const VIEW_W = 1276;
const VIEW_H = 637;

const M = 8;
const GAP = 6;
const ROW_H = 16;
const BRIEF_Y = 22;
const BRIEF_H = 42;
const REASON_H = 28;

const C = {
	bg: "#0d1117",
	card: "#161b22",
	cardBorder: "#30363d",
	text: "#e6edf3",
	textMuted: "#8b949e",
	accent: "#58a6ff",
	pv: "#f0b429",
	surplus: "#3fb950",
	grid: "#f85149",
	planA: "#58a6ff",
	planB: "#f0883e",
	ih: "#ffa657",
	ac: "#79c0ff",
	wb: "#d2a8ff",
};

const FS = { hero: "11px", val: "12px", valEm: "13px", lbl: "9px", tiny: "10px" };

function lcBlock() {
	return {
		"lc-type": "last-change",
		"lc-is-interval": true,
		"lc-is-moment": false,
		"lc-format": "",
		"lc-position-vert": "top",
		"lc-position-horz": "right",
		"lc-offset-vert": 0,
		"lc-offset-horz": 0,
		"lc-font-size": "9px",
		"lc-font-family": "",
		"lc-font-style": "",
		"lc-bkg-color": "",
		"lc-color": C.textMuted,
		"lc-border-width": "0",
		"lc-border-style": "",
		"lc-border-color": "",
		"lc-border-radius": 3,
		"lc-zindex": 0,
	};
}

function signalBlock() {
	const s = {};
	for (let i = 0; i < 3; i++) {
		s[`signals-cond-${i}`] = "==";
		s[`signals-val-${i}`] = true;
		s[`signals-icon-${i}`] = "/vis/signals/lowbattery.png";
		s[`signals-icon-size-${i}`] = 0;
		s[`signals-blink-${i}`] = false;
		s[`signals-horz-${i}`] = 0;
		s[`signals-vert-${i}`] = 0;
		s[`signals-hide-edit-${i}`] = false;
	}
	return s;
}

function gBlock(opts = {}) {
	return {
		g_fixed: opts.fixed ?? false,
		g_visibility: opts.visibility ?? false,
		g_css_font_text: opts.cssFont ?? true,
		g_css_background: opts.cssBg ?? true,
		g_css_shadow_padding: false,
		g_css_border: false,
		g_gestures: false,
		g_signals: false,
		g_last_change: false,
		"visibility-cond": "==",
		"visibility-val": 1,
		"visibility-groups-action": "hide",
		...signalBlock(),
		...lcBlock(),
	};
}

function htmlWidget(html, style, refresh = "0", opts = {}) {
	return {
		tpl: "tplHtml",
		data: { ...gBlock({ fixed: opts.fixed ?? false }), refreshInterval: refresh, html },
		style: { overflow: "hidden", "z-index": "10", color: C.text, ...style },
		widgetSet: "basic",
	};
}

function floatWidget(oid, prepend, style, digits = "1", append = "") {
	return {
		tpl: "tplValueFloat",
		data: {
			oid,
			...gBlock(),
			is_comma: "true",
			factor: "1",
			html_prepend: prepend,
			html_append_singular: append,
			html_append_plural: append,
			digits,
		},
		style: {
			height: `${ROW_H}px`,
			"z-index": "12",
			"font-weight": "400",
			color: C.text,
			"font-size": FS.val,
			"background-color": "transparent",
			border: "none",
			...style,
		},
		widgetSet: "basic",
	};
}

function stringWidget(oid, prepend, style) {
	return {
		tpl: "tplValueString",
		data: { oid, ...gBlock(), html_prepend: prepend, html_append: "" },
		style: {
			height: `${ROW_H}px`,
			"z-index": "12",
			"font-size": FS.val,
			"font-weight": "400",
			color: C.text,
			"background-color": "transparent",
			border: "none",
			...style,
		},
		widgetSet: "basic",
	};
}

function textBlockWidget(oid, prepend, style) {
	return {
		tpl: "tplValueString",
		data: { oid, ...gBlock(), html_prepend: prepend, html_append: "" },
		style: {
			"z-index": "12",
			"font-size": FS.tiny,
			"font-weight": "400",
			color: C.textMuted,
			"background-color": "transparent",
			border: "none",
			"line-height": "1.3",
			"white-space": "normal",
			"word-wrap": "break-word",
			overflow: "hidden",
			...style,
		},
		widgetSet: "basic",
	};
}

function cardPanel(left, top, width, height) {
	return {
		tpl: "i-vis-universal",
		data: {
			...gBlock({ cssBg: false }),
			iUniversalWidgetType: "Background",
			iValueType: "boolean",
			iValueComparison: "equal",
			iStateResponseTime: "0",
			iCornerRadiusUL: "6",
			iCornerRadiusUR: "6",
			iCornerRadiusLR: "6",
			iCornerRadiusLL: "6",
			iOpacityCtn: "0.95",
			iBorderWidth: "1",
			iBorderColor: C.cardBorder,
			iBorderColorActive: C.cardBorder,
			iBorderColorHover: "",
			oid: "",
			iTextTrue: "",
			iTextFalse: "",
			iFlipImage: false,
			iValueTrue: "true",
		},
		style: {
			left: `${left}px`,
			top: `${top}px`,
			width: `${width}px`,
			height: `${height}px`,
			"z-index": "2",
			"background-color": C.card,
		},
		widgetSet: "vis-inventwo",
	};
}

function sectionTitle(text, left, top, width, color = C.textMuted) {
	return htmlWidget(
		`<div style="font-family:system-ui,sans-serif;font-size:${FS.lbl};font-weight:700;color:${color};letter-spacing:0.05em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${text}</div>`,
		{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: "12px", "background-color": "transparent" },
	);
}

/** @typedef {{ type: 'f'|'s', oid: string, label: string, digits?: string, unit?: string, em?: boolean, color?: string }} RowDef */
/** @typedef {{ x: number, y: number, w: number, h: number, title?: string, titleOid?: string, color: string, rows: RowDef[] }} CardDef */

const widgets = {};
let n = 1;
function wid() {
	return `e${String(n++).padStart(5, "0")}`;
}

function oid(full) {
	return `${PREFIX}.${full}`;
}

/** @param {CardDef} card */
function buildCard(card) {
	widgets[wid()] = cardPanel(card.x, card.y, card.w, card.h);
	if (card.titleOid) {
		widgets[wid()] = stringWidget(oid(card.titleOid), "", {
			left: `${card.x + 6}px`,
			top: `${card.y + 4}px`,
			width: `${card.w - 12}px`,
			height: "12px",
			"font-size": FS.lbl,
			"font-weight": "700",
			color: card.color,
			"letter-spacing": "0.05em",
			"text-transform": "uppercase",
		});
	} else {
		widgets[wid()] = sectionTitle(card.title ?? "", card.x + 6, card.y + 4, card.w - 12, card.color);
	}
	let ry = card.y + 18;
	for (const row of card.rows) {
		const st = {
			left: `${card.x + 6}px`,
			top: `${ry}px`,
			width: `${card.w - 12}px`,
			height: `${ROW_H}px`,
			"font-size": row.em ? FS.valEm : FS.val,
			"font-weight": row.em ? "600" : "400",
			color: row.color ?? C.text,
		};
		widgets[wid()] =
			row.type === "f"
				? floatWidget(oid(row.oid), row.label, st, row.digits ?? "1", row.unit ?? "")
				: stringWidget(oid(row.oid), row.label, st);
		ry += ROW_H;
	}
}

function planBoardIframeHtml() {
	const src = `/adapter/ems/ems-charts.html?inst=${encodeURIComponent(PREFIX)}`;
	return `<iframe src="${src}" title="EMS Plan-Übersicht" style="width:100%;height:100%;border:0;background:#161b22;display:block;"></iframe>`;
}

// --- Layout coordinates (must fit 1276 × 637) ---
// y=0-20 header | briefing | live cards | Plan-Übersicht (iframe)

widgets[wid()] = {
	tpl: "i-vis-image-new",
	data: { ...gBlock({ fixed: true, cssFont: false, cssBg: false }), iImgScaleType: "iStretch", name: "BG" },
	style: { left: "0", top: "0", width: `${VIEW_W}px`, height: `${VIEW_H}px`, "z-index": "1", "background-color": C.bg },
	widgetSet: "vis-inventwo",
};

// Header
widgets[wid()] = htmlWidget(
	`<div style="font-family:system-ui,sans-serif;font-size:15px;font-weight:700;color:${C.text};">⚡ EMS</div>`,
	{ left: `${M}px`, top: "4px", width: "60px", height: "18px", "background-color": "transparent" },
);
widgets[wid()] = stringWidget(oid("system.version"), "v", {
	left: `${VIEW_W - 72}px`, top: "5px", width: "64px", height: "16px", "font-size": FS.tiny, color: C.textMuted,
});
widgets[wid()] = stringWidget(oid("planner.global_mode.active"), "Mode ", {
	left: "72px", top: "5px", width: "88px", height: "16px", "font-size": FS.val,
});
widgets[wid()] = stringWidget(oid("global.execution_mode"), "Exec ", {
	left: "168px", top: "5px", width: "72px", height: "16px", "font-size": FS.val,
});
widgets[wid()] = stringWidget(oid("planner.intent.daily_plan.status"), "Plan ", {
	left: "248px", top: "5px", width: "100px", height: "16px", "font-size": FS.val, color: C.accent,
});
widgets[wid()] = floatWidget(oid("planner.intent.daily_plan.revision"), "Rev ", {
	left: "356px", top: "5px", width: "56px", height: "16px", "font-size": FS.val,
}, "0", "");
widgets[wid()] = stringWidget(oid("planner.intent.forecast_plan.status"), "Fc ", {
	left: "420px", top: "5px", width: "88px", height: "16px", "font-size": FS.val,
});
widgets[wid()] = stringWidget(oid("ai.status"), "KI ", {
	left: "516px", top: "5px", width: "80px", height: "16px", "font-size": FS.val, color: C.planB,
});
widgets[wid()] = floatWidget(oid("ai.calls_today"), "Calls ", {
	left: "604px", top: "5px", width: "72px", height: "16px", "font-size": FS.val,
}, "0", "");
widgets[wid()] = floatWidget(oid("ai.calls_limit"), "/", {
	left: "676px", top: "5px", width: "40px", height: "16px", "font-size": FS.val, color: C.textMuted,
}, "0", "");

// Briefing (Operator Daily-Plan-Zusammenfassung, 2 Zeilen — Roadmap Block 3.3)
widgets[wid()] = cardPanel(M, BRIEF_Y, VIEW_W - 2 * M, BRIEF_H);
widgets[wid()] = textBlockWidget(oid("operator.briefing_de"), "", {
	left: `${M + 6}px`,
	top: `${BRIEF_Y + 4}px`,
	width: `${VIEW_W - 2 * M - 12}px`,
	height: `${BRIEF_H - 8}px`,
	"font-size": "10px",
	color: C.text,
});

// 6 live cards
const cardY = BRIEF_Y + BRIEF_H + 4;
const cardW = Math.floor((VIEW_W - 2 * M - 5 * GAP) / 6);
const cardH = 96;

for (const c of /** @type {CardDef[]} */ ([
	{
		x: M, y: cardY, w: cardW, h: cardH, title: "Energie", color: C.pv,
		rows: [
			{ type: "f", oid: "live.pv.power_w", label: "PV ", digits: "0", unit: " W", em: true, color: C.pv },
			{ type: "f", oid: "live.battery.house_load_w", label: "Last ", digits: "0", unit: " W" },
			{ type: "f", oid: "operator.diagnostics.surplus_w", label: "Üss ", digits: "0", unit: " W", em: true, color: C.surplus },
			{ type: "f", oid: "live.price.now_ct_per_kwh", label: "Preis ", digits: "2", unit: " ct" },
		],
	},
	{
		x: M + (cardW + GAP), y: cardY, w: cardW, h: cardH, title: "Batterie", color: C.accent,
		rows: [
			{ type: "f", oid: "live.battery.soc_pct", label: "SOC ", digits: "0", unit: " %", em: true, color: C.accent },
			{ type: "f", oid: "addons.battery.runtime.allocated_charge_power_w", label: "Plan ", digits: "0", unit: " W" },
			{ type: "s", oid: "addons.battery.runtime.surface.decision_source", label: "Src " },
			{ type: "s", oid: "addons.battery.runtime.surface.planner_status", label: "PlanSt " },
		],
	},
	{
		x: M + 2 * (cardW + GAP), y: cardY, w: cardW, h: cardH, title: "Heizstab", color: C.ih,
		rows: [
			{ type: "f", oid: "addons.immersion_heater.runtime.buffer_temperature_c", label: "Buf ", digits: "1", unit: "°", em: true, color: C.ih },
			{ type: "f", oid: "addons.immersion_heater.runtime.plan_target_temp_c", label: "Ziel ", digits: "1", unit: "°", color: C.ih },
			{ type: "f", oid: "addons.immersion_heater.runtime.allocated_power_w", label: "Plan ", digits: "0", unit: " W", color: C.ih },
			{ type: "s", oid: "addons.immersion_heater.runtime.surface.decision_source", label: "Src " },
		],
	},
	{
		x: M + 3 * (cardW + GAP), y: cardY, w: cardW, h: cardH, title: "Wallbox", color: C.wb,
		rows: [
			{ type: "f", oid: "live.wallbox.charge_power_w", label: "P ", digits: "0", unit: " W", em: true, color: C.wb },
			{ type: "s", oid: "addons.wallbox.runtime.surface.planner_status", label: "PlanSt " },
			{ type: "f", oid: "live.wallbox.vehicle_soc_pct", label: "SOC ", digits: "0", unit: " %" },
			{ type: "s", oid: "addons.wallbox.runtime.surface.decision_source", label: "Src " },
		],
	},
	{
		x: M + 4 * (cardW + GAP), y: cardY, w: cardW, h: cardH,
		titleOid: "addons.air_conditioning.units.unit_1.name", color: C.ac,
		rows: [
			{ type: "f", oid: "addons.air_conditioning.units.unit_1.allocated_power_w", label: "Plan ", digits: "0", unit: " W", em: true, color: C.ac },
			{ type: "s", oid: "addons.air_conditioning.runtime.surface.decision_source", label: "Src " },
			{ type: "s", oid: "addons.air_conditioning.runtime.surface.planner_status", label: "PlanSt " },
			{ type: "s", oid: "addons.air_conditioning.units.unit_1.running", label: "On " },
		],
	},
	{
		x: M + 5 * (cardW + GAP), y: cardY, w: cardW, h: cardH, title: "KI", color: C.planB,
		rows: [
			{ type: "s", oid: "ai.status", label: "St ", em: true, color: C.planB },
			{ type: "s", oid: "compare.active_plan", label: "Aktiv " },
			{ type: "s", oid: "ai.auto_suspended", label: "AutoAus " },
			{ type: "f", oid: "ai.cost_estimate_today_eur", label: "€ ", digits: "3", unit: "" },
		],
	},
])) {
	buildCard(c);
}

// Plan-Übersicht — fills rest (KI-Fragen + Add-on Daily-Plan-Karten)
const boardY = cardY + cardH + GAP;
const boardH = VIEW_H - boardY - M;

widgets[wid()] = cardPanel(M, boardY, VIEW_W - 2 * M, boardH);
widgets[wid()] = sectionTitle("Was plant das EMS?", M + 6, boardY + 4, 200, C.text);
widgets[wid()] = htmlWidget(planBoardIframeHtml(), {
	left: `${M + 2}px`,
	top: `${boardY + 16}px`,
	width: `${VIEW_W - 2 * M - 4}px`,
	height: `${boardH - 20}px`,
	"background-color": "transparent",
}, "0", { fixed: true });

const view = {
	settings: {
		style: { background_class: "", background: C.bg },
		theme: "dark-hive",
		sizex: String(VIEW_W),
		sizey: String(VIEW_H),
		gridSize: "",
		snapType: null,
		useBackground: true,
		alwaysRender: false,
	},
	widgets,
	name: "EMS Dashboard",
	filterList: [],
};

const out = join(__dirname, "ems-dashboard-view.json");
writeFileSync(out, JSON.stringify(view, null, 4), "utf8");

const chartsSrc = join(__dirname, "ems-charts.html");
const chartsAdmin = join(__dirname, "..", "admin", "ems-charts.html");
copyFileSync(chartsSrc, chartsAdmin);

// Sanity check layout fits
const maxY = boardY + boardH;
console.log(`Written ${out} (${Object.keys(widgets).length} widgets, ${VIEW_W}x${VIEW_H}, bottom=${maxY})`);
