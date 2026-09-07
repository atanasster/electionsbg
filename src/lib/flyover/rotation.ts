// Home playback starts with columns on every visit, then cycles all three programmes.
// An explicit ?scene= chooses the starting programme for capture and deep links.
import { PROGRAMME_IDS, type ProgrammeId } from "./programmes";

export const isProgrammeId = (
  value: string | null | undefined,
): value is ProgrammeId =>
  !!value && (PROGRAMME_IDS as readonly string[]).includes(value);

export const startingProgramme = (scene?: string | null): ProgrammeId =>
  isProgrammeId(scene) ? scene : "columns";

export const nextProgramme = (current: ProgrammeId): ProgrammeId =>
  PROGRAMME_IDS[(PROGRAMME_IDS.indexOf(current) + 1) % PROGRAMME_IDS.length]!;
