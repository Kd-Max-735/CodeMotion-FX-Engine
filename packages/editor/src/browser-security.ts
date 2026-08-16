function cookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function csrfToken(): string | undefined {
  return cookie("__Host-cmfx_csrf") ?? cookie("cmfx_dev_csrf");
}
