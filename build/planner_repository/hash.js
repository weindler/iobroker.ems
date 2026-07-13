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
exports.stableSemanticStringify = exports.sha256File = exports.sha256Hex = void 0;
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs/promises"));
function sha256Hex(content) {
    return (0, node_crypto_1.createHash)("sha256").update(content).digest("hex");
}
exports.sha256Hex = sha256Hex;
async function sha256File(filePath) {
    const buf = await fs.readFile(filePath);
    return sha256Hex(buf);
}
exports.sha256File = sha256File;
function stableSemanticStringify(value) {
    return JSON.stringify(value, (_key, v) => (v === undefined ? null : v));
}
exports.stableSemanticStringify = stableSemanticStringify;
