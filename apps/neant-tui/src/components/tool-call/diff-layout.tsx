import { createContext, useContext, type ReactNode } from "react";
import type { Settings } from "@neant/shared";
const DiffLayout = createContext<NonNullable<Settings["diffLayout"]>>("auto");
export function DiffLayoutProvider({
  value = "auto",
  children,
}: {
  value?: Settings["diffLayout"];
  children: ReactNode;
}) {
  return <DiffLayout value={value}>{children}</DiffLayout>;
}
export function useDiffLayout() {
  return useContext(DiffLayout);
}
