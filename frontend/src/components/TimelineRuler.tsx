"use client";

export default function TimelineRuler() {
  const ticks = Array.from({ length: 80 });

  return (
    <div className="w-full overflow-hidden py-3 select-none pointer-events-none opacity-30">
      <div className="relative mx-auto flex max-w-6xl items-end justify-between px-4 [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
        {ticks.map((_, i) => {
          const isMajor = i % 10 === 0;
          const isMedium = i % 5 === 0 && !isMajor;

          return (
            <div
              key={i}
              className={`w-[1px] bg-white transition-opacity ${
                isMajor
                  ? "h-4 opacity-70"
                  : isMedium
                  ? "h-2.5 opacity-40"
                  : "h-1.5 opacity-20"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
