import { describe, expect, it } from "vitest";
import {
  MODULE_LIST,
  MODULE_REGISTRY,
  modulePath,
  modulesOfScope,
  type ModuleScope,
} from "./moduleRegistry";
import { en } from "../i18n/en";

const SCOPES: ModuleScope[] = ["laminate", "material", "project"];

describe("the module registry", () => {
  it("is keyed by each module's own id", () => {
    for (const [key, mod] of Object.entries(MODULE_REGISTRY)) {
      expect(mod.id).toBe(key);
    }
  });

  it("partitions cleanly by scope", () => {
    const counted = SCOPES.flatMap((scope) => modulesOfScope(scope));
    expect(counted).toHaveLength(MODULE_LIST.length);
    expect(new Set(counted.map((m) => m.id)).size).toBe(MODULE_LIST.length);
  });

  it("has at least one module in every scope, or the scope is dead weight", () => {
    for (const scope of SCOPES) {
      expect(modulesOfScope(scope).length).toBeGreaterThan(0);
    }
  });

  it("builds a path that matches the scope", () => {
    // The routes are declared in App.tsx by these shapes; a module whose path
    // does not match its scope is a 404 nobody would notice until they clicked.
    for (const mod of MODULE_LIST) {
      const path = modulePath(mod, "owner-1");
      switch (mod.scope) {
        case "laminate":
          expect(path).toBe(`/laminates/owner-1/modules/${mod.id}`);
          break;
        case "material":
          expect(path).toBe(`/materials/owner-1/modules/${mod.id}`);
          break;
        case "project":
          expect(path).toBe(`/modules/${mod.id}`);
          break;
      }
    }
  });

  it("names every module in both catalogs", () => {
    for (const mod of MODULE_LIST) {
      expect(en[mod.labelKey]).toBeTruthy();
      expect(en[mod.descriptionKey]).toBeTruthy();
    }
  });
});
