import Image from "next/image";

export function ProfilePhoto({
  url,
  firstName,
  lastName,
  size = "small",
}: {
  url: string | null;
  firstName: string;
  lastName: string;
  size?: "small" | "large";
}) {
  const initials = `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase() || "?";
  const pixels = size === "large" ? 112 : 42;
  return (
    <span className={`entity-photo entity-photo-${size}`} aria-label={`${firstName} ${lastName} profile photo`}>
      {url ? (
        <Image src={url} alt="" width={pixels} height={pixels} sizes={`${pixels}px`} unoptimized />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
