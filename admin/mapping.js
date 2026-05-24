/* global parent */
"use strict";

const COMMANDS = [
	{ id: "set_enabled", label: "set_enabled (Laden erlauben)" },
	{ id: "set_current_a", label: "set_current_a (Ampere)" },
	{ id: "set_charge_power_w", label: "set_charge_power_w (Watt → Ampere)" },
	{ id: "set_phase_switch_enabled", label: "set_phase_switch_enabled (Phasenumschaltung)" },
];

const GOE_TEMPLATE = {
	set_enabled: { enabled: true, target_state: "go-e.0.allow_charging", allowed_values: "[true,false,0,1]" },
	set_current_a: { enabled: true, target_state: "go-e.0.ampere", allowed_values: "" },
	set_charge_power_w: { enabled: true, target_state: "go-e.0.ampere", allowed_values: "" },
	set_phase_switch_enabled: {
		enabled: true,
		target_state: "go-e.0.phaseSwitchModeEnabled",
		allowed_values: "[true,false]",
	},
};

let onChangeCallback = null;

function defaultEntry() {
	return { enabled: true, target_state: "", allowed_values: "" };
}

function escapeAttr(s) {
	return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function renderForm(wallbox) {
	const root = document.getElementById("wallbox-mapping");
	if (!root) return;
	root.innerHTML = "";
	for (const cmd of COMMANDS) {
		const e = wallbox[cmd.id] || defaultEntry();
		const row = document.createElement("div");
		row.className = "mapping-row";
		row.innerHTML =
			`<label>${cmd.label}</label>` +
			`<label><input type="checkbox" data-cmd="${cmd.id}" data-field="enabled" ${e.enabled !== false ? "checked" : ""} /> Mapping aktiv</label>` +
			`<div class="mapping-target">` +
			`<input type="text" id="target-${cmd.id}" data-cmd="${cmd.id}" data-field="target_state" value="${escapeAttr(e.target_state || "")}" placeholder="z. B. go-e.0.ampere" />` +
			`<button type="button" class="btn" data-pick="${cmd.id}">State wählen…</button>` +
			`</div>` +
			`<label>Erlaubte Werte (JSON-Array, optional)` +
			`<input type="text" data-cmd="${cmd.id}" data-field="allowed_values" value="${escapeAttr(e.allowed_values || "")}" style="width:100%;margin-top:0.2rem" />` +
			`</label>`;
		root.appendChild(row);
	}
	root.querySelectorAll("input").forEach((inp) => {
		inp.addEventListener("change", fireChange);
		inp.addEventListener("input", fireChange);
	});
	root.querySelectorAll("[data-pick]").forEach((btn) => {
		btn.addEventListener("click", () => pickState(btn.getAttribute("data-pick")));
	});
}

function readForm() {
	const wallbox = {};
	for (const cmd of COMMANDS) {
		const enabled = document.querySelector(`input[data-cmd="${cmd.id}"][data-field="enabled"]`);
		const target = document.querySelector(`input[data-cmd="${cmd.id}"][data-field="target_state"]`);
		const allowed = document.querySelector(`input[data-cmd="${cmd.id}"][data-field="allowed_values"]`);
		wallbox[cmd.id] = {
			enabled: enabled ? enabled.checked : true,
			target_state: target ? target.value.trim() : "",
			allowed_values: allowed ? allowed.value.trim() : "",
		};
	}
	return wallbox;
}

function pickState(cmdId) {
	const input = document.getElementById("target-" + cmdId);
	if (!input) return;

	const apply = (id) => {
		if (id) {
			input.value = id;
			fireChange();
		}
	};

	try {
		if (parent.adapterMain && typeof parent.adapterMain.selectId === "function") {
			parent.adapterMain.selectId(input, "state", apply);
			return;
		}
	} catch (_e) {
		/* iframe */
	}

	const manual = window.prompt(
		"State-ID eingeben (z. B. go-e.0.ampere):\n\nTipp: Objekte → Filter „go-e“ → State kopieren.",
		input.value || "",
	);
	if (manual && manual.trim()) {
		input.value = manual.trim();
		fireChange();
	}
}

function fireChange() {
	if (typeof onChangeCallback === "function") {
		onChangeCallback(true);
	}
}

function load(settings, onChange) {
	onChangeCallback = onChange;
	const wallbox =
		settings && settings.mapping && settings.mapping.wallbox ? settings.mapping.wallbox : {};
	renderForm(wallbox);
	const btn = document.getElementById("btn-goe-template");
	if (btn) {
		btn.onclick = function () {
			renderForm(GOE_TEMPLATE);
			fireChange();
		};
	}
	onChange(false);
}

function save(callback) {
	callback({
		mapping: {
			wallbox: readForm(),
		},
	});
}

function initPage() {
	renderForm({});
	const btn = document.getElementById("btn-goe-template");
	if (btn) {
		btn.onclick = function () {
			renderForm(GOE_TEMPLATE);
			fireChange();
		};
	}
}

window.load = load;
window.save = save;

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initPage);
} else {
	initPage();
}
