import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import logoOrgas from "@/assets/orgas-logo.png";

interface LogoProps {
  className?: string;
  size?: number;
  alt?: string;
}

export function Logo({ className, size = 32, alt = "Orgas" }: LogoProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: "currentColor",
    WebkitMaskImage: `url(${logoOrgas})`,
    maskImage: `url(${logoOrgas})`,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskMode: "luminance",
    maskMode: "luminance",
  };

  return (
    <span
      role="img"
      aria-label={alt}
      className={cn("inline-block text-primary", className)}
      style={style}
    />
  );
}
