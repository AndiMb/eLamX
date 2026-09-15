// Spring-in state and result, one instance per laminate.
//
// The same shape as `vibrationAtoms`, and for the same reason: an input the
// user edits, persisted per laminate, and an async result derived from it plus
// the laminate. What is unusual here is how cheap the result is - a handful of
// multiplications on top of the ABD matrix - so there is no separate summary
// atom and nothing is sliced out of the response.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage, selectAtom } from "jotai/utils";
import { loadableWithLastValue } from "../lib/loadable";
import type { SpringInInputDto, SpringInResponse } from "../lib/types";
import { elamx } from "../lib/wasm";
import { laminateRequestFamily } from "./derivedAtoms";

/** Mirrors elamx-core's SpringInInput::default, which mirrors the Java one. */
export function defaultSpringInInput(): SpringInInputDto {
  return {
    model: { model: "simple_radford" },
    model_name: "Simple Radford Model",
    angle: 90,
    radius: 10,
    alphat_thick: 3e-5,
    base_temp: 25,
    hardening_temp: 180,
    use_auto_calc_alphat_thick: false,
    zero_deg_as_circum_dir: true,
  };
}

/**
 * A stored input from before the model was an object, or with a field the core
 * has since gained, filled in from the default.
 *
 * `model` in particular: it is a discriminated union in the file and in the
 * core, and a shape without the `model` tag would fail deserialisation on the
 * Rust side with a message about an unknown variant rather than about an old
 * saved input.
 */
function normalise(input: SpringInInputDto): SpringInInputDto {
  const fallback = defaultSpringInInput();
  const model =
    input?.model && (input.model.model === "simple_radford" || input.model.model === "enhanced_radford")
      ? input.model
      : fallback.model;
  return { ...fallback, ...input, model };
}

const json = createJSONStorage<SpringInInputDto>(() => localStorage);
const storage = {
  ...json,
  getItem: (key: string, initial: SpringInInputDto) => normalise(json.getItem(key, initial)),
};

export const springInStorageKey = (laminateId: string) => `elamx.springIn.${laminateId}`;

export const springInInputFamily = atomFamily((laminateId: string) =>
  atomWithStorage<SpringInInputDto>(
    springInStorageKey(laminateId),
    defaultSpringInInput(),
    storage,
    { getOnInit: true },
  ),
);

export const springInResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<SpringInResponse>>(async (get) => {
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const input = get(springInInputFamily(laminateId));
    const json = await elamx.compute_spring_in(JSON.stringify({ laminate, materials, input }));
    return JSON.parse(json) as SpringInResponse;
  }),
);

export const loadableSpringInFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(springInResponseFamily(laminateId)),
);

export const springInErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadableSpringInFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);
