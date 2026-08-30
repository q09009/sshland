export const PERMISSION_ROWS = [
  { key: "owner", masks: [0o400, 0o200, 0o100] as const },
  { key: "group", masks: [0o040, 0o020, 0o010] as const },
  { key: "others", masks: [0o004, 0o002, 0o001] as const },
] as const;

export const PERMISSION_COLUMNS = ["read", "write", "execute"] as const;

/** Convert a listing string such as `-rwxr-xr--` to its 0o754 mode. */
export function permissionModeFromString(value: string): number | null {
  if (value.length < 10) return null;
  let mode = 0;
  const masks = PERMISSION_ROWS.flatMap((row) => [...row.masks]);
  for (let index = 0; index < masks.length; index += 1) {
    const character = value[index + 1];
    if (character !== "-") mode |= masks[index];
  }
  return mode;
}

export function togglePermission(mode: number, mask: number): number {
  return mode & mask ? mode & ~mask : mode | mask;
}

export function octalPermissionMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}
