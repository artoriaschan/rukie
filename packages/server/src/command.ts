import { Value } from "typebox/value";
import { WireCommandSchema, type WireCommand } from "@rukie/shared";

/** Validate untrusted wire input before command dispatch. */
export function parseWireCommand(input: unknown): WireCommand | undefined {
  return Value.Check(WireCommandSchema, input) ? input : undefined;
}
