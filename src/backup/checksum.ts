import * as crypto from "node:crypto";

export function sha256Buffer(data: Buffer | string): string {
	const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
	return crypto.createHash("sha256").update(buf).digest("hex");
}

export function sha256FileContent(content: string | Buffer): string {
	return sha256Buffer(content);
}
