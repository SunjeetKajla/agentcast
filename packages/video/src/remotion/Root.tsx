import type { ComponentType } from "react";
import { Composition } from "remotion";
import { outputSize, planParts, type VideoInput } from "../plan.ts";
import { Video } from "./Video.tsx";

/** One composition; its size and length follow from the input the worker passes (render.ts). */
export function Root() {
  return (
    <Composition
      id="Main"
      component={Video as unknown as ComponentType<Record<string, unknown>>}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={30}
      calculateMetadata={({ props }) => {
        const input = props as unknown as VideoInput;
        const { w, h } = outputSize(input.aspect, input.height);
        return {
          width: w,
          height: h,
          fps: input.edl.fps,
          durationInFrames: planParts(input.edl, input.narration).frames,
        };
      }}
    />
  );
}
