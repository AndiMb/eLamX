import { describe, expect, it } from "vitest";
import { defaultStiffener, withProfile, withStiffeners } from "./stiffeners";
import { STIFFENER_PROFILES, type StiffenerDto } from "./types";

describe("defaultStiffener", () => {
  it("makes a stiffener that actually stiffens, for every profile", () => {
    // eLamX's own constructors fill everything with zero. Here the result
    // recomputes as you type, so a stiffener that changes nothing on being
    // added reads as a broken feature.
    for (const profile of STIFFENER_PROFILES) {
      const s = defaultStiffener(profile.id, "S1");
      expect(s.profile).toBe(profile.id);
      expect(s.name).toBe("S1");
      for (const field of profile.fields) {
        const value = (s as unknown as Record<string, number>)[field];
        expect(value, `${profile.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("withProfile", () => {
  const blade: StiffenerDto = {
    name: "Rippe",
    direction: "y",
    position: -80,
    profile: "i_profile",
    w1: 45,
    t1: 4,
    e: 72000,
    g: 27500,
    rho: 2.7e-9,
  };

  it("keeps what means the same under any profile", () => {
    for (const profile of STIFFENER_PROFILES) {
      const changed = withProfile(blade, profile.id);
      expect(changed.name).toBe("Rippe");
      expect(changed.direction).toBe("y");
      expect(changed.position).toBe(-80);
      // The material is the material, whatever shape it is rolled into.
      expect(changed.e).toBe(72000);
      expect(changed.g).toBe(27500);
      expect(changed.rho).toBe(2.7e-9);
    }
  });

  it("does not carry a dimension over to a parameter that means something else", () => {
    // w1 is a blade's HEIGHT and a T's flange WIDTH. Keeping the 45 would turn
    // a tall blade into a wide flange without the user touching anything.
    const t = withProfile(blade, "t_profile");
    expect(t.profile).toBe("t_profile");
    if (t.profile !== "t_profile") throw new Error("unreachable");
    expect(t.w1).not.toBe(45);
    expect(t.w2).toBeGreaterThan(0);
  });

  it("is a no-op on the profile it already has", () => {
    expect(withProfile(blade, "i_profile")).toBe(blade);
  });

  it("gives the direct input every section property the core asks for", () => {
    const direct = withProfile(blade, "direct");
    if (direct.profile !== "direct") throw new Error("unreachable");
    for (const value of [direct.e, direct.i, direct.g, direct.j, direct.a, direct.rho]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("withStiffeners", () => {
  it("fills in a list that a stored input predates", () => {
    // Not hypothetical: every plate input persisted before this feature has no
    // `stiffeners` key at all, and the editor maps over it before the core
    // ever sees it.
    const stored = { length: 500, width: 500 } as unknown as { stiffeners: StiffenerDto[] };
    expect(withStiffeners(stored).stiffeners).toEqual([]);
  });

  it("leaves an input that has one alone, object identity and all", () => {
    const input = { stiffeners: [defaultStiffener("i_profile", "S1")] };
    expect(withStiffeners(input)).toBe(input);
  });
});
