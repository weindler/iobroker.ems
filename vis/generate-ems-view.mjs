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
const HEAD_H = 22;
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
	return `<iframe src="${src}" title="EMS Energie-Übersicht" style="width:100%;height:100%;border:0;background:#161b22;display:block;"></iframe>`;
}

// --- Layout coordinates (must fit 1276 × 637) ---
// y=0-22 compact header | operations iframe (live chips start immediately)

widgets[wid()] = {
	tpl: "i-vis-image-new",
	data: { ...gBlock({ fixed: true, cssFont: false, cssBg: false }), iImgScaleType: "iStretch", name: "BG" },
	style: { left: "0", top: "0", width: `${VIEW_W}px`, height: `${VIEW_H}px`, "z-index": "1", "background-color": C.bg },
	widgetSet: "vis-inventwo",
};

// Header — EMS | Modus … | Steuerung … | v…
widgets[wid()] = htmlWidget(
	`<div style="font-family:system-ui,sans-serif;font-size:14px;font-weight:700;color:${C.text};">EMS</div>`,
	{ left: `${M}px`, top: "4px", width: "40px", height: "16px", "background-color": "transparent" },
);
widgets[wid()] = stringWidget(oid("planner.global_mode.active"), " | Modus ", {
	left: "48px", top: "5px", width: "168px", height: "16px", "font-size": FS.val,
});
widgets[wid()] = stringWidget(oid("global.execution_mode"), " | Steuerung ", {
	left: "220px", top: "5px", width: "168px", height: "16px", "font-size": FS.val,
});
widgets[wid()] = stringWidget(oid("system.version"), " | v", {
	left: `${VIEW_W - 88}px`, top: "5px", width: "80px", height: "16px", "font-size": FS.tiny, color: C.textMuted,
});

const boardY = HEAD_H;
const boardH = VIEW_H - boardY - M;

widgets[wid()] = cardPanel(M, boardY, VIEW_W - 2 * M, boardH);
widgets[wid()] = htmlWidget(planBoardIframeHtml(), {
	left: `${M + 2}px`,
	top: `${boardY + 2}px`,
	width: `${VIEW_W - 2 * M - 4}px`,
	height: `${boardH - 4}px`,
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
		// true: View bleibt aktiv / subscribed, wenn man kurz woanders hinspringt —
		// sonst wirken Widget-Werte „eingefroren“, bis der View neu gemountet wird.
		alwaysRender: true,
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
