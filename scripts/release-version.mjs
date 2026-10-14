export function isReleaseVersion(version) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/.exec(version);
  if (!match) return false;
  const [, year, month, day, increment] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    (!increment || Number(increment) > 0)
  );
}
