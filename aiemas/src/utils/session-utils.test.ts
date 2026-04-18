import { describe, expect, it } from "vitest";
import { constructKeyFromUuid } from "./session-utils.js";

describe("constructKeyFromUuid", () => {
  it("returns a canonical agent group key", () => {
    expect(constructKeyFromUuid("AieIaas Resource", "MAS-D4548844")).toBe(
      "agent:aieiaas-resource:group:mas-d4548844",
    );
  });

  it("preserves already canonical inputs", () => {
    expect(constructKeyFromUuid("aieiaas-resource", "mas-d4548844")).toBe(
      "agent:aieiaas-resource:group:mas-d4548844",
    );
  });
});
