export function resolveAccessTokenExpiresIn(
  client: string | undefined,
  defaultExpiresIn: string,
): string {
  return client === 'cli' ? '3d' : defaultExpiresIn;
}
