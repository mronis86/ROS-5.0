/**
 * ROS app version: V{YY}.{M}.{D}.{Letter}{Cycle}
 * e.g. V26.9.23.A1 = first production push on 2026-09-23.
 * A–Z = push within a 26-push block; after Z1 comes A2.
 * Bump with: npm run version:bump (before each production push).
 */
import rosVersionFile from '../ros-version.json';

export type RosVersionInfo = {
  version: string;
  date: string;
  seq: number;
};

export const ROS_APP_VERSION: string =
  (rosVersionFile as RosVersionInfo)?.version || 'V0.0.0.A1';

export const ROS_APP_VERSION_DATE: string =
  (rosVersionFile as RosVersionInfo)?.date || '';

export const ROS_APP_VERSION_SEQ: number =
  Number((rosVersionFile as RosVersionInfo)?.seq) || 0;

export function getRosVersionInfo(): RosVersionInfo {
  return {
    version: ROS_APP_VERSION,
    date: ROS_APP_VERSION_DATE,
    seq: ROS_APP_VERSION_SEQ,
  };
}

/** seq 1 → A1, 26 → Z1, 27 → A2 */
export function formatRosVersionSuffix(seq: number): string {
  const n = Math.max(1, Math.floor(seq));
  const letter = String.fromCharCode(65 + ((n - 1) % 26));
  const cycle = Math.floor((n - 1) / 26) + 1;
  return `${letter}${cycle}`;
}

export function formatRosVersionFromDate(d: Date, seq: number): string {
  const yy = String(d.getFullYear()).slice(-2);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `V${yy}.${m}.${day}.${formatRosVersionSuffix(seq)}`;
}
