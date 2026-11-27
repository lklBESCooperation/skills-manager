import type { SkillEnablementFileIO } from '../enablement/skill-enablement-applier';
/**
 * Bounded file reader: validates `size <= maxBytes` before reading into memory
 * and stops reading if the file grows beyond `maxBytes`.
 */
export declare function readFileBounded(filePath: string, maxBytes?: number): Promise<{
    buffer: Buffer;
}>;
export declare function createLocalSkillEnablementFileIO(maxBytes?: number): SkillEnablementFileIO;
