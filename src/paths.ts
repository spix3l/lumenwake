const base = import.meta.env.BASE_URL;

export function assetUrl(path: string): string {
  return `${base}${path.replace(/^\//, '')}`;
}
