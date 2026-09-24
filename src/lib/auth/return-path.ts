export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/patients";
  const path = value.trim();
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\?#\u0000-\u001f\u007f]/.test(path) ||
    path === "/login" ||
    path.startsWith("/login/") ||
    path === "/auth" ||
    path.startsWith("/auth/")
  ) return "/patients";
  return path;
}
