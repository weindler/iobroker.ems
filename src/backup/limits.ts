/** Harte Ressourcenlimits — kein ZIP64; Archive bleiben darunter. */

export const EXPORT_LIMITS = {
	/** Max. Nutzdateien pro Archiv (ohne manifest.json). */
	MAX_ARCHIVE_PAYLOAD_FILES: 64,
	/** Max. Größe einer einzelnen JSON-/NDJSON-Datei. */
	MAX_SINGLE_FILE_BYTES: 2 * 1024 * 1024,
	/** Max. Gesamtgröße unkomprimiert (Store-ZIP, kein ZIP64). */
	MAX_UNCOMPRESSED_ARCHIVE_BYTES: 32 * 1024 * 1024,
	/** Max. fertiges Backup-Archiv. */
	MAX_BACKUP_ARCHIVE_BYTES: 16 * 1024 * 1024,
	/** Max. fertiges Support-Archiv. */
	MAX_SUPPORT_ARCHIVE_BYTES: 8 * 1024 * 1024,
	/** Max. eingelesene Persistenzdatei. */
	MAX_PERSIST_FILE_READ_BYTES: 2 * 1024 * 1024,
	MAX_JSON_STRING_LENGTH: 512_000,
	MAX_JSON_ARRAY_LENGTH: 10_000,
	MAX_JSON_DEPTH: 32,
} as const;

export function assertWithinLimit(actual: number, limit: number, label: string): void {
	if (actual > limit) {
		throw new Error(`${label} exceeds limit (${actual} > ${limit})`);
	}
}
