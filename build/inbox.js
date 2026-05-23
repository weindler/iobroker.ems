"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseInboxValue = void 0;
/** Admin/json state: value may be object or JSON string. */
function parseInboxValue(val) {
    if (val === null || val === undefined)
        return null;
    let data;
    if (typeof val === "string") {
        const s = val.trim();
        if (!s)
            return null;
        try {
            data = JSON.parse(s);
        }
        catch {
            return null;
        }
    }
    else if (typeof val === "object") {
        data = val;
    }
    else {
        return null;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data))
        return null;
    return data;
}
exports.parseInboxValue = parseInboxValue;
